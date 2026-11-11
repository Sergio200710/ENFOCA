import { OperationError } from "./storage.js";
import { validateTitle } from "./goals.js";

export const ACTIVITY_STATES = {
  scheduled: "Programada", in_progress: "En curso", completed_on_time: "Completada puntualmente",
  completed_late: "Completada con retraso", skipped: "Omitida", cancelled: "Cancelada",
};
const TRANSITIONS = { scheduled: ["start", "skip", "cancel"], in_progress: ["finish", "cancel"] };

export function validateDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value) || value.startsWith("0000") || Number.isNaN(Date.parse(`${value}T12:00:00Z`)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) throw new OperationError("Elige una fecha válida.");
  return value;
}
export function validateClock(value) {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)) throw new OperationError("Elige hora y minutos en formato de 24 horas.");
  return value;
}
export function buildSchedule({ date, startTime, endTime }) {
  validateDay(date); validateClock(startTime); validateClock(endTime);
  if (endTime <= startTime) throw new OperationError("La finalización debe ser posterior al inicio, dentro del mismo día.");
  const start = new Date(`${date}T${startTime}:00`);
  const end = new Date(`${date}T${endTime}:00`);
  for (const [instant, clock] of [[start, startTime], [end, endTime]]) {
    if (instant.getHours() !== Number(clock.slice(0, 2)) || instant.getMinutes() !== Number(clock.slice(3))) throw new OperationError("Esta hora no existe en la zona horaria del dispositivo por un cambio de horario.");
  }
  if (end <= start) throw new OperationError("El final debe ser posterior al inicio.");
  return { date, startTime, endTime, startAt: start.toISOString(), endAt: end.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}
export function sameWallSchedule(schedule, input) {
  return schedule.date === input.date && schedule.startTime === input.startTime && schedule.endTime === input.endTime;
}
export function occupiesSlot(activity) {
  return !activity.deletedAt && !["skipped", "cancelled"].includes(activity.status);
}
export function schedulesOverlap(left, right) {
  return left.id !== right.id && occupiesSlot(left) && occupiesSlot(right) && left.schedule.startAt < right.schedule.endAt && right.schedule.startAt < left.schedule.endAt;
}
export function overlapSignature(activities) {
  return activities.map(({ id, version }) => `${id}:${version}`).sort().join("|");
}
export class OverlapError extends OperationError {
  constructor(conflicts) {
    super("Este horario coincide con otras actividades. Revisa los solapamientos y confirma si son intencionados.");
    this.name = "OverlapError";
    this.conflicts = conflicts;
  }
}
export function sortActivities(activities) {
  return [...activities].sort((a, b) => a.schedule.startAt.localeCompare(b.schedule.startAt) || a.schedule.endAt.localeCompare(b.schedule.endAt) || a.id.localeCompare(b.id));
}
export function punctuality(activity) {
  return {
    startDelayMs: activity.actualStartAt ? Math.max(0, Date.parse(activity.actualStartAt) - Date.parse(activity.schedule.startAt)) : null,
    endDelayMs: activity.actualEndAt ? Math.max(0, Date.parse(activity.actualEndAt) - Date.parse(activity.schedule.endAt)) : null,
  };
}
function title(input) {
  try { return validateTitle(input); }
  catch (error) { throw new OperationError(error.message.replaceAll("objetivo", "actividad")); }
}
function goalId(value) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 100) throw new OperationError("El objetivo vinculado no es válido.");
  return value;
}

export function createActivityService(repository, { now = () => new Date(), uuid = () => crypto.randomUUID() } = {}) {
  function revise(current, changes, event, timestamp) {
    return { ...current, ...changes, updatedAt: timestamp, version: current.version + 1, syncState: "pending", stateHistory: [...current.stateHistory, { type: event, at: timestamp, version: current.version + 1 }] };
  }
  return {
    list(date) { validateDay(date); return repository.list(date).then(sortActivities); },
    create(input, consent = "") {
      const timestamp = now().toISOString();
      const schedule = buildSchedule(input);
      return repository.create({ id: uuid(), title: title(input.title), goalId: goalId(input.goalId ?? null), schedule,
        scheduleHistory: [{ schedule: { ...schedule }, changedAt: timestamp, version: 1 }], status: "scheduled",
        actualStartAt: null, actualEndAt: null, skippedAt: null, cancelledAt: null, deletedAt: null,
        stateHistory: [], reminders: [], schemaVersion: 1, version: 1, syncState: "pending", createdAt: timestamp, updatedAt: timestamp }, consent);
    },
    edit(previous, input, consent = "") {
      const nextTitle = title(input.title);
      const nextGoal = goalId(input.goalId ?? null);
      const timestamp = now().toISOString();
      return repository.update(previous.id, previous.version, (current) => {
        if (current.deletedAt) throw new OperationError("Esta actividad está eliminada de la agenda.");
        const changed = !sameWallSchedule(current.schedule, input);
        if (changed && current.status !== "scheduled") throw new OperationError("El horario queda fijado al iniciar, omitir o cancelar una actividad. Puedes editar su título y su vínculo.");
        const schedule = changed ? buildSchedule(input) : current.schedule;
        return revise(current, { title: nextTitle, goalId: nextGoal, schedule,
          scheduleHistory: changed ? [...current.scheduleHistory, { schedule: { ...schedule }, changedAt: timestamp, version: current.version + 1 }] : current.scheduleHistory }, changed ? "rescheduled" : "edited", timestamp);
      }, consent);
    },
    transition(previous, event) {
      const timestamp = now().toISOString();
      return repository.update(previous.id, previous.version, (current) => {
        if (current.deletedAt || !TRANSITIONS[current.status]?.includes(event)) throw new OperationError("Esta transición no está permitida. Solo se puede finalizar una actividad que esté en curso.");
        let changes;
        if (event === "start") changes = { status: "in_progress", actualStartAt: timestamp };
        if (event === "skip") changes = { status: "skipped", skippedAt: timestamp };
        if (event === "cancel") {
          if (current.actualStartAt && timestamp < current.actualStartAt) throw new OperationError("El reloj del dispositivo es anterior al inicio registrado. Revisa la hora antes de cancelar.");
          changes = { status: "cancelled", cancelledAt: timestamp };
        }
        if (event === "finish") {
          if (!current.actualStartAt || timestamp < current.actualStartAt) throw new OperationError("El final real no puede ser anterior al inicio registrado. Revisa el reloj del dispositivo.");
          changes = { actualEndAt: timestamp, status: current.actualStartAt > current.schedule.startAt || timestamp > current.schedule.endAt ? "completed_late" : "completed_on_time" };
        }
        return revise(current, changes, event, timestamp);
      });
    },
    remove(previous) {
      const timestamp = now().toISOString();
      return repository.update(previous.id, previous.version, (current) => {
        if (current.deletedAt) throw new OperationError("La actividad ya se había eliminado de la agenda.");
        // Eliminación lógica: conserva ejecución e historial para sincronización futura.
        return revise(current, { deletedAt: timestamp }, "removed", timestamp);
      });
    },
  };
}
