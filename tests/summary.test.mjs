import test from "node:test";
import assert from "node:assert/strict";
import { dailySummary, motivation, consecutiveDays, summaryHistory, celebration } from "../assets/js/summary.js";
import { createSummaryRepository } from "../assets/js/summary-storage.js";

const day = "2031-05-20";
let sequence = 0;
function activity(status = "scheduled", date = day, extra = {}) {
  return { id: `fixture-${++sequence}`, status, schedule: { date, startAt: `${date}T09:00:00.000Z` }, deletedAt: null, actualStartAt: null, ...extra };
}
test("día vacío: recuentos cero, porcentaje indefinido y sin felicitación", () => {
  const result = dailySummary([], day);
  assert.equal(result.planned, 0); assert.equal(result.percentage, null);
  assert.equal(result.allComplete, false); assert.equal(celebration(result), null);
  assert.equal(motivation(result).kind, "empty");
});
test("denominador explícito, estados pendientes y separación entre cumplimiento y puntualidad", () => {
  const records = [activity("scheduled"), activity("in_progress"), activity("completed_on_time"), activity("completed_late"), activity("skipped"), activity("cancelled"), activity("scheduled", day, { deletedAt: "now" }), activity("completed_on_time", "2031-05-21")];
  const result = dailySummary(records, day);
  assert.equal(result.planned, 6); assert.equal(result.required, 5);
  assert.equal(result.completed, 2); assert.equal(result.pending, 2); assert.equal(result.inProgress, 1);
  assert.equal(result.skipped, 1); assert.equal(result.cancelled, 1);
  assert.equal(result.completedOnTime, 1); assert.equal(result.completedLate, 1); assert.equal(result.percentage, 40);
});
test("día completo puntual y día completo con retraso reciben mensajes distintos", () => {
  const punctual = dailySummary([activity("completed_on_time"), activity("cancelled")], day);
  const late = dailySummary([activity("completed_on_time"), activity("completed_late")], day);
  assert.equal(punctual.percentage, 100); assert.equal(punctual.allPunctual, true);
  assert.equal(late.percentage, 100); assert.equal(late.allComplete, true); assert.equal(late.allPunctual, false);
  assert.notEqual(celebration(punctual).title, celebration(late).title);
  assert.equal(motivation(late).kind, "complete");
});
test("omitidas siguen siendo exigibles; todas canceladas no generan cumplimiento ni felicitación", () => {
  const skipped = dailySummary([activity("completed_on_time"), activity("skipped")], day);
  assert.equal(skipped.percentage, 50); assert.equal(celebration(skipped), null);
  const cancelled = dailySummary([activity("cancelled")], day);
  assert.equal(cancelled.planned, 1); assert.equal(cancelled.required, 0);
  assert.equal(cancelled.percentage, null); assert.equal(celebration(cancelled), null);
  assert.equal(motivation(cancelled).kind, "cancelled");
});
test("redondeo de tercios y límite 99% para días incompletos", () => {
  assert.equal(dailySummary([activity("completed_on_time"), activity(), activity()], day).percentage, 33);
  assert.equal(dailySummary([activity("completed_on_time"), activity("completed_late"), activity()], day).percentage, 67);
  const almost = dailySummary([...Array.from({ length: 200 }, () => activity("completed_on_time")), activity()], day);
  assert.equal(almost.percentage, 99); assert.equal(almost.allComplete, false);
});
test("cambios posteriores, reapertura y traslado de fecha invalidan el resultado anterior", () => {
  const done = activity("completed_on_time");
  assert.equal(dailySummary([done], day).allComplete, true);
  assert.equal(dailySummary([{ ...done, status: "scheduled" }], day).allComplete, false);
  assert.equal(dailySummary([done, activity()], day).percentage, 50);
  assert.equal(dailySummary([{ ...done, deletedAt: "now" }], day).percentage, null);
  assert.equal(dailySummary([{ ...done, schedule: { ...done.schedule, date: "2031-05-21" } }], day).planned, 0);
});
test("mensajes para días en curso, pendientes, parciales, omitidos y con retrasos", () => {
  assert.equal(motivation(dailySummary([activity("in_progress")], day)).kind, "in-progress");
  assert.equal(motivation(dailySummary([activity()], day)).kind, "pending");
  assert.equal(motivation(dailySummary([activity("completed_on_time"), activity()], day)).kind, "partial");
  assert.equal(motivation(dailySummary([activity("skipped")], day)).kind, "skipped");
  const delayed = dailySummary([activity("in_progress", day, { actualStartAt: `${day}T09:01:00.000Z` })], day);
  assert.equal(delayed.hasDelays, true); assert.match(motivation(delayed).text, /retraso/);
  assert.match(motivation(dailySummary([activity("completed_late"), activity("skipped")], day)).text, /omitidas/);
});
test("rachas solo de días naturales consecutivos con datos, también a través de cambios de mes", () => {
  const records = [activity("completed_on_time", "2031-04-30"), activity("completed_late", "2031-05-01"), activity("completed_on_time", "2031-05-02")];
  assert.equal(consecutiveDays(records, "2031-05-02", "2031-05-02"), 3);
  assert.match(motivation(dailySummary(records, "2031-05-02"), 3).text, /3 días naturales/);
  assert.equal(consecutiveDays(records.filter((item) => item.schedule.date !== "2031-05-01"), "2031-05-02", "2031-05-02"), 1);
  assert.equal(consecutiveDays(records, "2031-05-02", "2031-05-01"), 0);
  assert.equal(consecutiveDays([...records, activity("cancelled", "2031-05-03")], "2031-05-03", "2031-05-03"), 0);
  assert.equal(consecutiveDays([...records, activity("skipped", "2031-05-02")], "2031-05-02", "2031-05-02"), 0);
});
test("historial ordenado, sin inventar días vacíos ni incluir fechas futuras", () => {
  const records = [activity("scheduled", "2031-05-19"), activity("completed_on_time", "2031-05-17"), activity("scheduled", "2031-05-21"), activity("scheduled", "2031-05-18", { deletedAt: "now" })];
  assert.deepEqual(summaryHistory(records, day).map((item) => item.date), ["2031-05-19", "2031-05-17"]);
});
test("no muta actividades ni oculta estados desconocidos", () => {
  const records = [activity("completed_late"), activity("scheduled")];
  const before = structuredClone(records);
  dailySummary(records, day); summaryHistory(records, "2031-05-22"); consecutiveDays(records, day, day);
  assert.deepEqual(records, before);
  assert.throws(() => dailySummary([activity("unknown")], day), /estado no reconocido/);
});
test("el repositorio diferencia fallos de almacenamiento y ausencia de registros", async () => {
  await assert.rejects(createSummaryRepository(null).snapshot(day), /IndexedDB/);
  await assert.rejects(createSummaryRepository({ open() { throw new DOMException("denied", "SecurityError"); } }).snapshot(day), /almacenamiento/);
});
