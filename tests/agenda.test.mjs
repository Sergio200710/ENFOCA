import test from "node:test";
import assert from "node:assert/strict";
import { createActivityService, buildSchedule, schedulesOverlap, overlapSignature, punctuality, sortActivities, ACTIVITY_STATES } from "../assets/js/agenda.js";
import { createActivityRepository } from "../assets/js/agenda-storage.js";

function fixture() {
  const records = new Map();
  let clock = new Date("2026-11-11T08:00:00");
  const repository = {
    async create(item) { records.set(item.id, structuredClone(item)); return structuredClone(item); },
    async update(id, version, transform) {
      const current = records.get(id);
      assert.equal(current.version, version);
      const next = transform(structuredClone(current));
      records.set(id, structuredClone(next));
      return structuredClone(next);
    },
    async list(date) { return [...records.values()].filter((item) => item.schedule.date === date).map((item) => structuredClone(item)); },
  };
  return { records, service: createActivityService(repository, { now: () => clock }), time(value) { clock = new Date(value); } };
}
const input = (changes = {}) => ({ title: "Estudiar", date: "2026-11-11", startTime: "09:00", endTime: "10:00", goalId: null, ...changes });

test("valida fechas, textos y horarios estrictos de un mismo día", async () => {
  const { service } = fixture();
  for (const changes of [{ title: " " }, { title: "x".repeat(161) }, { date: "2026-02-30" }, { startTime: "9:00" }, { startTime: "24:00" }, { endTime: "08:59" }, { endTime: "09:00" }, { endTime: "01:00" }]) assert.throws(() => service.create(input(changes)));
  const activity = await service.create(input());
  assert.match(activity.id, /^[0-9a-f-]{36}$/);
  assert.equal(activity.version, 1); assert.equal(activity.schemaVersion, 1);
  assert.equal(activity.actualStartAt, null); assert.equal(activity.actualEndAt, null);
  assert.deepEqual(activity.reminders, []);
});
test("reprogramar preserva el horario original y bloquea cambios después de iniciar", async () => {
  const { service, time } = fixture();
  const original = await service.create(input());
  const changed = await service.edit(original, input({ startTime: "10:00", endTime: "11:00" }));
  assert.equal(changed.scheduleHistory.length, 2);
  assert.deepEqual(changed.scheduleHistory[0].schedule, original.schedule);
  assert.equal(changed.scheduleHistory[1].schedule.startTime, "10:00");
  time("2026-11-11T10:00:00");
  const started = await service.transition(changed, "start");
  await assert.rejects(service.edit(started, input({ startTime: "11:00", endTime: "12:00" })), /horario queda fijado/);
  const renamed = await service.edit(started, input({ title: "Otro título", startTime: "10:00", endTime: "11:00" }));
  assert.equal(renamed.actualStartAt, started.actualStartAt);
  assert.deepEqual(renamed.scheduleHistory, changed.scheduleHistory);
});
test("puntualidad sin tolerancia: anticipado, exacto, retraso de inicio o de final", async () => {
  for (const [start, end, expected] of [["08:59:00", "10:00:00", "completed_on_time"], ["09:00:00", "10:00:00", "completed_on_time"], ["09:00:00.001", "09:59:00", "completed_late"], ["09:00:00", "10:00:00.001", "completed_late"]]) {
    const { service, time } = fixture(); let activity = await service.create(input());
    time(`2026-11-11T${start}`); activity = await service.transition(activity, "start");
    const actualStartAt = activity.actualStartAt;
    time(`2026-11-11T${end}`); activity = await service.transition(activity, "finish");
    assert.equal(activity.status, expected); assert.equal(activity.actualStartAt, actualStartAt);
    assert.equal(activity.actualEndAt, new Date(`2026-11-11T${end}`).toISOString());
    if (start.endsWith(".001")) assert.equal(punctuality(activity).startDelayMs, 1);
    if (end.endsWith(".001")) assert.equal(punctuality(activity).endDelayMs, 1);
  }
});
test("matriz completa de transiciones, sin finalización de actividades nunca iniciadas", async () => {
  const allowed = { scheduled: ["start", "skip", "cancel"], in_progress: ["finish", "cancel"] };
  for (const status of Object.keys(ACTIVITY_STATES)) for (const event of ["start", "finish", "skip", "cancel"]) {
    const { service, records, time } = fixture();
    const activity = await service.create(input());
    activity.status = status;
    if (status !== "scheduled") activity.actualStartAt = new Date("2026-11-11T09:00:00").toISOString();
    records.set(activity.id, structuredClone(activity));
    time("2026-11-11T10:00:00");
    if (allowed[status]?.includes(event)) await service.transition(activity, event);
    else await assert.rejects(service.transition(activity, event), /transición/);
  }
});
test("omitir y cancelar no inventan ejecución; cancelar en curso preserva el inicio", async () => {
  const { service, time } = fixture();
  const skipped = await service.transition(await service.create(input()), "skip");
  assert.equal(skipped.actualStartAt, null); assert.equal(skipped.actualEndAt, null);
  const cancelled = await service.transition(await service.create(input()), "cancel");
  assert.equal(cancelled.actualStartAt, null); assert.equal(cancelled.actualEndAt, null);
  time("2026-11-11T09:01:00");
  const started = await service.transition(await service.create(input()), "start");
  time("2026-11-11T09:02:00");
  const stopped = await service.transition(started, "cancel");
  assert.equal(stopped.actualStartAt, started.actualStartAt); assert.equal(stopped.actualEndAt, null);
  assert.equal(stopped.status, "cancelled");
});
test("rechaza final real anterior al inicio y mantiene la actividad en curso", async () => {
  const { service, time } = fixture();
  time("2026-11-11T09:02:00");
  const started = await service.transition(await service.create(input()), "start");
  time("2026-11-11T09:01:00");
  await assert.rejects(service.transition(started, "finish"), /anterior/);
  assert.equal((await service.list("2026-11-11"))[0].status, "in_progress");
});
test("solapamientos, límites contiguos y exclusión de omitidas, canceladas y eliminadas", async () => {
  const { service } = fixture();
  const a = await service.create(input());
  const b = await service.create(input({ startTime: "09:30", endTime: "10:30" }));
  const adjacent = await service.create(input({ startTime: "10:00", endTime: "11:00" }));
  assert.equal(schedulesOverlap(a, b), true); assert.equal(schedulesOverlap(a, adjacent), false);
  assert.equal(schedulesOverlap(a, a), false);
  for (const changed of [{ status: "skipped" }, { status: "cancelled" }, { deletedAt: "now" }]) assert.equal(schedulesOverlap(a, { ...b, ...changed }), false);
  assert.notEqual(overlapSignature([b]), overlapSignature([{ ...b, version: b.version + 1 }]));
});
test("orden cronológico, fechas independientes y ausencia de finalización automática", async () => {
  const { service, time } = fixture();
  const late = await service.create(input({ startTime: "12:00", endTime: "13:00" }));
  const early = await service.create(input());
  await service.create(input({ date: "2026-11-12" }));
  time("2026-11-15T20:00:00");
  assert.deepEqual((await service.list("2026-11-11")).map((item) => item.id), [early.id, late.id]);
  assert.equal((await service.list("2026-11-12"))[0].status, "scheduled");
  assert.deepEqual(sortActivities([late, early]).map((item) => item.id), [early.id, late.id]);
});
test("eliminación lógica conserva historial y horas reales", async () => {
  const { service, time } = fixture(); let activity = await service.create(input());
  time("2026-11-11T09:00:00"); activity = await service.transition(activity, "start");
  const removed = await service.remove(activity);
  assert.ok(removed.deletedAt); assert.equal(removed.actualStartAt, activity.actualStartAt);
  assert.deepEqual(removed.scheduleHistory, activity.scheduleHistory);
  assert.equal((await service.list("2026-11-11")).length, 1);
  await assert.rejects(service.transition(removed, "finish"), /transición/);
});
test("repositorio de actividades propaga errores de IndexedDB", async () => {
  await assert.rejects(createActivityRepository(null).list("2026-11-11"), /IndexedDB/);
  await assert.rejects(createActivityRepository({ open() { throw new DOMException("denied", "SecurityError"); } }).list("2026-11-11"), /almacenamiento/);
});
