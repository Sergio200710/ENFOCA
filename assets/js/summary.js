import { ACTIVITY_STATES, validateDay } from "./agenda.js";
import { OperationError } from "./storage.js";

export function dailySummary(activities, date) {
  validateDay(date);
  const records = activities.filter((activity) => activity.schedule.date === date && !activity.deletedAt);
  const counts = Object.fromEntries(Object.keys(ACTIVITY_STATES).map((key) => [key, 0]));
  for (const activity of records) {
    if (!Object.hasOwn(counts, activity.status)) throw new OperationError("Una actividad tiene un estado no reconocido. No se puede calcular un resumen fiable.");
    counts[activity.status]++;
  }
  const planned = records.length;
  const completed = counts.completed_on_time + counts.completed_late;
  const required = planned - counts.cancelled;
  const allComplete = required > 0 && completed === required;
  return {
    date, planned, completed, required,
    pending: counts.scheduled + counts.in_progress,
    inProgress: counts.in_progress,
    skipped: counts.skipped, cancelled: counts.cancelled,
    completedOnTime: counts.completed_on_time, completedLate: counts.completed_late,
    // Un entero redondeado nunca anuncia 100% con actividades sin completar.
    percentage: !required ? null : allComplete ? 100 : Math.min(99, Math.round(completed / required * 100)),
    allComplete, allPunctual: allComplete && counts.completed_on_time === required,
    hasDelays: counts.completed_late > 0 || records.some((activity) => activity.status === "in_progress" && activity.actualStartAt && activity.actualStartAt > activity.schedule.startAt),
  };
}

function previousDay(date) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

export function consecutiveDays(activities, endDate, today) {
  validateDay(endDate); validateDay(today);
  if (endDate > today) return 0;
  const groups = new Map();
  for (const activity of activities) {
    if (activity.deletedAt || activity.schedule.date > endDate) continue;
    const day = activity.schedule.date;
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(activity);
  }
  let count = 0;
  let day = endDate;
  while (groups.has(day) && dailySummary(groups.get(day), day).allComplete) {
    count++; day = previousDay(day);
  }
  return count;
}

export function motivation(summary, streak = 0) {
  if (!summary.planned) return { kind: "empty", text: "Este día aún no tiene actividades. Puedes reservar un pequeño espacio para lo que te importa." };
  if (!summary.required) return { kind: "cancelled", text: "Los planes de este día cambiaron. Las actividades canceladas no cuentan para el cumplimiento; puedes organizar el siguiente paso a tu ritmo." };
  let kind;
  let text;
  if (summary.allPunctual) {
    kind = "complete-punctual";
    text = "Has completado todas las actividades exigibles y respetado sus horarios. Date un momento para reconocer lo que has hecho.";
  } else if (summary.allComplete) {
    kind = "complete";
    text = "Has completado todas las actividades exigibles. Aunque hubo retrasos, lo que has hecho también cuenta.";
  } else if (summary.inProgress) {
    kind = "in-progress";
    text = "Tienes una actividad en marcha. Céntrate en este paso; el resto puede esperar su momento.";
  } else if (summary.completed) {
    kind = "partial";
    text = "Ya has completado parte de lo que habías previsto. Puedes seguir con un paso más, a tu ritmo.";
  } else if (summary.pending) {
    kind = "pending";
    text = "Hay actividades pendientes. Elige por dónde empezar y dedica tu atención a una sola cosa.";
  } else {
    kind = "skipped";
    text = "Algunas actividades quedaron sin hacer. Puedes revisar lo que necesitas para organizar tus próximos días.";
  }
  if (summary.skipped && kind !== "skipped") text += " Hay actividades omitidas; revisa tus próximos planes sin exigirte empezar de cero.";
  if (summary.hasDelays && !summary.allComplete) text += " Un retraso no borra el esfuerzo que estás haciendo. Continúa a tu ritmo.";
  if (streak >= 3) text += ` Hasta esta fecha has encadenado ${streak} días naturales completando todas las actividades exigibles registradas. Paso a paso también se construye constancia.`;
  return { kind, text };
}

export function summaryHistory(activities, today) {
  validateDay(today);
  const dates = [...new Set(activities.filter((activity) => !activity.deletedAt && activity.schedule.date < today).map((activity) => activity.schedule.date))].sort().reverse();
  return dates.map((date) => dailySummary(activities, date));
}

export function celebration(summary) {
  if (!summary.allComplete) return null;
  return summary.allPunctual
    ? { title: "Un día completo y puntual", text: "Has completado todas las actividades exigibles de este día y todas fueron puntuales. Bien hecho. Ahora también puedes darte espacio para descansar." }
    : { title: "Has completado lo que te propusiste", text: "Todas las actividades exigibles de este día están completadas. Hubo retrasos, así que cumplimiento total y puntualidad total son resultados distintos. Tu avance merece ser reconocido." };
}
