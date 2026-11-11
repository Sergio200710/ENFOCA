import test from "node:test";
import assert from "node:assert/strict";
import { emptyAnswers, validateAnswers, validateTime, createProfileService } from "../assets/js/profile.js";
import { createProfileRepository } from "../assets/js/profile-storage.js";

test("respuestas opcionales sin mezclar ausencia de perfil con errores", async () => {
  assert.deepEqual(validateAnswers({}), emptyAnswers());
  const service = createProfileService({ load: async () => null });
  assert.equal(await service.load(), null);
  await assert.rejects(createProfileService({ load: async () => { throw new Error("storage failure"); } }).load(), /storage failure/);
});
test("opciones múltiples canónicas sin duplicados y enums estrictos", () => {
  const answers = validateAnswers({ goals: ["balance", "time", "time"], sport: "none", procrastination: "rarely", reminders: "hourly" });
  assert.deepEqual(answers.goals, ["time", "balance"]);
  for (const input of [{ sport: "unknown" }, { procrastination: 1 }, { reminders: "email" }, { goals: ["<script>"] }, { goals: "time" }, { unknown: "value" }, null, []]) assert.throws(() => validateAnswers(input));
});
test("horarios HH:mm válidos, medianoche y rechazo de formatos inválidos", () => {
  for (const value of ["00:00", "07:05", "23:59", null]) assert.equal(validateTime(value), value);
  for (const value of ["24:00", "12:60", "7:05", "07:5", "07:05:00", "7 PM", "", 700]) assert.throws(() => validateTime(value));
  assert.doesNotThrow(() => validateAnswers({ wakeTime: "17:00", bedTime: "08:00" }));
});
test("finalización y omisión vacías se guardan versionadas en un único perfil", async () => {
  let current = null;
  const repo = { load: async () => current, save: async (record, expected) => { assert.equal(expected, current?.version ?? 0); current = record; return record; } };
  const service = createProfileService(repo);
  const first = await service.save(null, emptyAnswers(), "completed");
  assert.equal(first.id, "local");
  assert.equal(first.version, 1);
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.onboardingStatus, "completed");
  const second = await service.save(first, { ...emptyAnswers(), sport: "regular" }, "skipped");
  assert.equal(second.version, 2);
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.syncState, "pending");
  const cleared = await service.save(second, emptyAnswers(), "completed");
  assert.equal(cleared.answers.sport, null);
  assert.equal(second.answers.sport, "regular");
  assert.throws(() => service.save(cleared, emptyAnswers(), "invalid"));
});
test("el guardado espera la confirmación del repositorio y propaga el aborto", async () => {
  let rejectSave;
  const service = createProfileService({ save: () => new Promise((_, reject) => { rejectSave = reject; }) });
  let confirmed = false;
  const saving = service.save(null, emptyAnswers(), "completed").then(() => { confirmed = true; });
  assert.equal(confirmed, false);
  rejectSave(new Error("transaction aborted"));
  await assert.rejects(saving, /transaction aborted/);
  assert.equal(confirmed, false);
});
test("perfiles incompatibles o con respuestas corruptas no se tratan como vacíos", async () => {
  for (const profile of [{ id: "local", schemaVersion: 99, version: 1 }, { id: "local", schemaVersion: 1, version: 1, onboardingStatus: "completed", answers: { sport: "invalid" } }]) {
    await assert.rejects(createProfileService({ load: async () => profile }).load());
  }
});
test("repositorio de perfil maneja IndexedDB no disponible o denegado", async () => {
  await assert.rejects(createProfileRepository(null).load(), /IndexedDB/);
  await assert.rejects(createProfileRepository({ open() { throw new DOMException("denied", "SecurityError"); } }).load(), /almacenamiento/);
});
