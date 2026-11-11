import { dailySummary } from "./summary.js";
import { validateDay } from "./agenda.js";

// Fechas civiles en UTC: ni los cambios de hora ni la zona del navegador
// añaden o quitan días al calendario. No se modifican registros.
export function shiftDay(day, offset) {
  validateDay(day);
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  const result = value.toISOString().slice(0, 10);
  validateDay(result);
  return result;
}

export function daysBetween(start, end) {
  validateDay(start); validateDay(end);
  if (start > end) throw new RangeError("El inicio debe ser anterior al final del periodo.");
  const days = [];
  let day = start;
  while (day <= end) {
    days.push(day);
    if (day === end) break;
    day = shiftDay(day, 1);
  }
  return days;
}

export function percentage(completed, required) {
  return !required ? null : completed === required ? 100 : Math.min(99, Math.round(completed / required * 100));
}

export function aggregate(days) {
  const result = { planned: 0, completed: 0, required: 0, completedOnTime: 0, completedLate: 0, recordedDays: 0, requiredDays: 0 };
  for (const day of days) {
    for (const key of ["planned", "completed", "required", "completedOnTime", "completedLate"]) result[key] += day[key];
    if (day.planned) result.recordedDays++;
    if (day.required) result.requiredDays++;
  }
  result.percentage = percentage(result.completed, result.required);
  // Puntualidad de las actividades completadas, no del total planificado.
  result.punctuality = percentage(result.completedOnTime, result.completed);
  return result;
}

export function intensity(day) {
  if (!day.planned) return "empty";
  if (!day.required) return "excluded";
  if (!day.percentage) return "zero";
  return String(Math.ceil(day.percentage / 25));
}

export function curveSegments(days) {
  const segments = [];
  let segment = [];
  days.forEach((day, index) => {
    if (day.percentage === null) {
      if (segment.length) segments.push(segment);
      segment = [];
    } else segment.push({ index, date: day.date, percentage: day.percentage });
  });
  if (segment.length) segments.push(segment);
  return segments;
}

export function createPulseModel(activities) {
  const groups = new Map();
  for (const activity of activities) {
    if (activity.deletedAt) continue;
    const day = activity.schedule.date;
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(activity);
  }
  const cache = new Map();
  const day = (date) => {
    if (!cache.has(date)) cache.set(date, dailySummary(groups.get(date) || [], date));
    return cache.get(date);
  };
  const range = (start, end) => daysBetween(start, end).map(day);
  return {
    day, range,
    period(end, length) {
      if (![7, 30].includes(length)) throw new RangeError("El periodo debe ser de 7 o 30 días.");
      const start = shiftDay(end, 1 - length);
      const days = range(start, end);
      const current = aggregate(days);
      const previous = aggregate(range(shiftDay(start, -length), shiftDay(start, -1)));
      const comparable = current.requiredDays >= 3 && previous.requiredDays >= 3;
      // Diferencia entre ratios exactos; nunca promedio de porcentajes diarios.
      const change = comparable ? Math.round((current.completed / current.required - previous.completed / previous.required) * 1000) / 10 : null;
      return { start, end, days, current, previous, change };
    },
    calendar(end) {
      validateDay(end);
      return {
        month: aggregate(range(`${end.slice(0, 7)}-01`, end)),
        year: aggregate(range(`${end.slice(0, 4)}-01-01`, end)),
      };
    },
  };
}
