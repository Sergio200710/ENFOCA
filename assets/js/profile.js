export const QUESTIONS = [
  { key: "goals", title: "¿Qué quieres conseguir con ENFOCA?", type: "multiple", hint: "Puedes elegir varias opciones, o ninguna.", options: [
    ["time", "Organizar mejor mi tiempo."],
    ["procrastination", "Dejar de procrastinar."],
    ["consistency", "Ser más constante."],
    ["balance", "Equilibrar estudios, trabajo y vida personal."],
  ] },
  { key: "sport", title: "¿Practicas algún deporte?", type: "single", options: [
    ["regular", "Sí, habitualmente."], ["sometimes", "A veces."], ["none", "No actualmente."],
  ] },
  { key: "procrastination", title: "¿Sueles posponer tus tareas?", type: "single", options: [
    ["rarely", "Casi nunca."], ["sometimes", "Algunas veces."], ["often", "Con frecuencia."],
  ] },
  { key: "wakeTime", title: "¿A qué hora te levantas normalmente?", type: "time", hint: "Hora habitual en formato de 24 horas. También puedes dejarla sin responder." },
  { key: "bedTime", title: "¿A qué hora sueles acostarte?", type: "time", hint: "Hora habitual en formato de 24 horas. No hace falta que todos tus días sean iguales." },
  { key: "reminders", title: "¿Cómo prefieres recibir recordatorios?", type: "single", hint: "Solo guardaremos tu preferencia. Todavía no se enviarán avisos.", options: [
    ["at-time", "Solo a la hora de cada actividad."], ["before", "Un aviso antes de cada actividad."], ["hourly", "Un resumen cada hora."],
  ] },
];

export function emptyAnswers() {
  return { goals: [], sport: null, procrastination: null, wakeTime: null, bedTime: null, reminders: null };
}

export function validateTime(value) {
  if (value === null) return null;
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)) throw new Error("Elige una hora válida en formato HH:mm, de 00:00 a 23:59.");
  return value;
}

export function validateAnswers(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Las respuestas no tienen un formato válido.");
  if (Object.keys(input).some((key) => !QUESTIONS.some((question) => question.key === key))) throw new Error("Hay una respuesta no admitida.");
  const answers = emptyAnswers();
  for (const question of QUESTIONS) {
    const value = input[question.key] ?? (question.type === "multiple" ? [] : null);
    if (question.type === "time") answers[question.key] = validateTime(value);
    else if (question.type === "multiple") {
      if (!Array.isArray(value) || value.length > question.options.length || value.some((item) => !question.options.some(([code]) => item === code))) throw new Error("Elige únicamente las opciones de objetivo personal disponibles.");
      answers[question.key] = question.options.map(([code]) => code).filter((code) => value.includes(code));
    } else {
      if (value !== null && !question.options.some(([code]) => value === code)) throw new Error("Elige una de las opciones disponibles o borra la respuesta.");
      answers[question.key] = value;
    }
  }
  return answers;
}

function validateProfile(profile) {
  if (profile === null) return null;
  if (profile.id !== "local" || profile.schemaVersion !== 1 || !Number.isSafeInteger(profile.version) || profile.version < 1 || !["pending", "completed", "skipped"].includes(profile.onboardingStatus)) throw new Error("No se puede leer esta versión del perfil. No se han sobrescrito tus preferencias.");
  return { ...profile, answers: validateAnswers(profile.answers) };
}

export function createProfileService(repository, { now = () => new Date() } = {}) {
  return {
    async load() { return validateProfile(await repository.load()); },
    save(previous, answers, onboardingStatus) {
      if (!["completed", "skipped"].includes(onboardingStatus)) throw new Error("El estado del onboarding no es válido.");
      const normalized = validateAnswers(answers);
      const timestamp = now().toISOString();
      return repository.save({ id: "local", schemaVersion: 1, version: (previous?.version ?? 0) + 1, createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp, syncState: "pending", onboardingStatus, answers: normalized }, previous?.version ?? 0);
    },
  };
}
