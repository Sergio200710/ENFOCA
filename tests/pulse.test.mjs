import test from "node:test";
import assert from "node:assert/strict";
import { createPulseModel, aggregate, curveSegments, intensity, shiftDay, percentage } from "../assets/js/pulse.js";

const activity = (date, status = "scheduled", extra = {}) => ({ schedule: { date }, status, ...extra });

test("Pulse diferencia vacío, cancelaciones y cero real; omitidas cuentan como exigibles", () => {
  const model = createPulseModel([activity("2026-11-01", "cancelled"), activity("2026-11-02", "skipped"), activity("2026-11-03", "completed_on_time", { deletedAt: "2026-11-04" })]);
  assert.equal(intensity(model.day("2026-11-01")), "excluded");
  assert.equal(intensity(model.day("2026-11-02")), "zero");
  assert.equal(intensity(model.day("2026-11-03")), "empty");
  assert.equal(model.day("2026-11-01").percentage, null);
  assert.equal(model.day("2026-11-02").percentage, 0);
});

test("agrega actividades, no promedios diarios; puntualidad usa completadas", () => {
  const records = [activity("2026-11-01", "completed_on_time"), activity("2026-11-02", "completed_late"), ...Array.from({ length: 8 }, () => activity("2026-11-02")), activity("2026-11-02", "cancelled")];
  const result = createPulseModel(records).period("2026-11-02", 7).current;
  assert.equal(result.percentage, 20);
  assert.equal(result.completed, 2); assert.equal(result.required, 10);
  assert.equal(result.punctuality, 50); assert.equal(result.planned, 11);
  assert.equal(percentage(199, 200), 99);
  assert.equal(percentage(200, 200), 100);
  assert.equal(percentage(0, 0), null);
});

test("segmentos de la curva no cruzan fechas sin datos o sin exigibles", () => {
  const model = createPulseModel([activity("2026-11-01", "completed_on_time"), activity("2026-11-02", "skipped"), activity("2026-11-04", "completed_late"), activity("2026-11-05", "cancelled"), activity("2026-11-06")]);
  const segments = curveSegments(model.range("2026-11-01", "2026-11-06"));
  assert.deepEqual(segments.map(s => s.map(p => p.index)), [[0, 1], [3], [5]]);
  assert.equal(segments[0][1].percentage, 0);
});

test("calendario real cruza cambios de hora, mes, año y febrero bisiesto", () => {
  assert.equal(shiftDay("2026-03-29", 1), "2026-03-30");
  assert.equal(shiftDay("2026-10-25", 1), "2026-10-26");
  assert.equal(shiftDay("2024-03-01", -1), "2024-02-29");
  assert.equal(shiftDay("2026-01-01", -1), "2025-12-31");
  const model = createPulseModel([]);
  assert.equal(model.period("2026-01-01", 30).days.length, 30);
  assert.equal(model.period("2026-01-01", 7).start, "2025-12-26");
  assert.throws(() => model.period("2026-01-01", 8));
  assert.throws(() => model.day("2026-02-30"));
});

test("evolución solo con tres días exigibles por periodo, calculada con ratios exactos", () => {
  const records = [1, 2, 3].flatMap(n => [activity(`2026-11-0${n}`, "skipped"), activity(`2026-11-${String(n + 7).padStart(2, "0")}`, "completed_on_time")]);
  const model = createPulseModel(records);
  assert.equal(model.period("2026-11-14", 7).change, 100);
  assert.equal(createPulseModel(records.slice(1)).period("2026-11-14", 7).change, null);
  assert.equal(createPulseModel([]).period("2026-11-14", 7).change, null);
  assert.equal(aggregate([]).punctuality, null);
});

test("mes y año solo incluyen registros hasta la fecha elegida", () => {
  const model = createPulseModel([activity("2025-12-31", "completed_on_time"), activity("2026-10-31", "completed_on_time"), activity("2026-11-01", "completed_late"), activity("2026-11-15", "skipped"), activity("2026-12-01", "completed_on_time")]);
  const result = model.calendar("2026-11-10");
  assert.equal(result.month.completed, 1); assert.equal(result.month.percentage, 100);
  assert.equal(result.year.completed, 2); assert.equal(result.year.required, 2);
});

test("un nuevo snapshot refleja cambios, sin mutar actividades ni admitir estados desconocidos", () => {
  const records = [activity("2026-11-01")];
  const initial = JSON.stringify(records);
  assert.equal(createPulseModel(records).day("2026-11-01").percentage, 0);
  assert.equal(JSON.stringify(records), initial);
  const updated = [{ ...records[0], status: "completed_late" }];
  assert.equal(createPulseModel(updated).day("2026-11-01").percentage, 100);
  assert.throws(() => createPulseModel([activity("2026-11-01", "unknown")]).day("2026-11-01"));
});
