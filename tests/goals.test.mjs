import test from "node:test";
import assert from "node:assert/strict";
import { validateTitle, dailyProgress, localDate, createGoalService } from "../assets/js/goals.js";
import { createGoalRepository, StorageError } from "../assets/js/storage.js";

test("normaliza títulos y rechaza vacíos, controles y textos demasiado largos", () => {
  assert.equal(validateTitle("  Leer   diez páginas  "), "Leer diez páginas");
  assert.equal(validateTitle("cafe\u0301"), "café");
  for (const input of ["", "   ", "a".repeat(161), "texto\u0000", null]) assert.throws(() => validateTitle(input));
  assert.equal(validateTitle("a".repeat(160)).length, 160);
});
test("progreso real: vacío, parcial y completo; excluye otras fechas y archivados", () => {
  const date = "2026-11-11";
  const goal = { date, status: "completed" };
  assert.deepEqual(dailyProgress([], date), { total: 0, completed: 0, percentage: 0 });
  assert.deepEqual(dailyProgress([goal], date), { total: 1, completed: 1, percentage: 100 });
  assert.deepEqual(dailyProgress([goal, { ...goal, status: "pending" }, { ...goal, status: "pending" }, { ...goal, date: "2026-11-12" }, { ...goal, archivedAt: "now" }, { ...goal, deletedAt: "now" }], date), { total: 3, completed: 1, percentage: 33 });
});
test("fecha local antes y después de medianoche", () => {
  assert.equal(localDate(new Date(2026, 10, 11, 23, 59)), "2026-11-11");
  assert.equal(localDate(new Date(2026, 10, 12, 0, 1)), "2026-11-12");
});
test("UUID y metadatos de sincronización; fechas inválidas no escriben", async () => {
  const records = [];
  const service = createGoalService({ add(goal) { records.push(goal); return Promise.resolve(goal); } });
  const goal = await service.create("Leer", "2026-11-11");
  assert.match(goal.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(goal.version, 1);
  assert.equal(goal.schemaVersion, 1);
  assert.equal(goal.syncState, "pending");
  assert.equal(goal.completedAt, null);
  for (const date of ["2026-02-30", "invalid", "2026-1-1"]) assert.throws(() => service.create("Leer", date));
  assert.equal(records.length, 1);
  assert.throws(() => service.remove(goal), /Archiva/);
});
test("IndexedDB no disponible, denegado o bloqueado devuelve errores recuperables", async () => {
  await assert.rejects(createGoalRepository(null).list("2026-11-11"), StorageError);
  await assert.rejects(createGoalRepository({ open() { throw new DOMException("denied", "SecurityError"); } }).list("2026-11-11"), StorageError);
  const blocked = { open() { const request = {}; setTimeout(() => request.onblocked(), 0); return request; } };
  await assert.rejects(createGoalRepository(blocked).list("2026-11-11"), /Otra pestaña/);
});
