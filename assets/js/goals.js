export const TITLE_LIMIT = 160;
export function localDate(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
export function validateTitle(input) {
  if (typeof input !== "string") throw new Error("Escribe un título para tu objetivo.");
  const title = input.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!title) throw new Error("Escribe un título para tu objetivo.");
  if (title.length > TITLE_LIMIT) throw new Error(`El título no puede superar ${TITLE_LIMIT} caracteres.`);
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(title)) throw new Error("El título contiene caracteres no válidos.");
  return title;
}
function validateDate(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("La fecha del objetivo no es válida.");
}
export function dailyProgress(goals, date) {
  const active = goals.filter((goal) => goal.date === date && !goal.archivedAt && !goal.deletedAt);
  const completed = active.filter((goal) => goal.status === "completed").length;
  return { total: active.length, completed, percentage: active.length ? Math.round(completed / active.length * 100) : 0 };
}
export function createGoalService(repository, { now = () => new Date(), uuid = () => globalThis.crypto.randomUUID() } = {}) {
  function revise(goal, changes) {
    return { ...goal, ...changes, updatedAt: now().toISOString(), version: goal.version + 1, syncState: "pending" };
  }
  return {
    list(date) { validateDate(date); return repository.list(date); },
    create(input, date) {
      const title = validateTitle(input);
      validateDate(date);
      const timestamp = now().toISOString();
      return repository.add({ id: uuid(), title, date, status: "pending", completedAt: null, archivedAt: null, deletedAt: null, createdAt: timestamp, updatedAt: timestamp, version: 1, schemaVersion: 1, syncState: "pending" });
    },
    edit(goal, input) {
      const title = validateTitle(input);
      return repository.update(goal.id, goal.version, (current) => revise(current, { title }));
    },
    setCompleted(goal, completed) {
      return repository.update(goal.id, goal.version, (current) => revise(current, { status: completed ? "completed" : "pending", completedAt: completed ? now().toISOString() : null }));
    },
    archive(goal) { return repository.update(goal.id, goal.version, (current) => revise(current, { archivedAt: now().toISOString() })); },
    restore(goal) { return repository.update(goal.id, goal.version, (current) => revise(current, { archivedAt: null })); },
    remove(goal) {
      if (!goal.archivedAt) throw new Error("Archiva el objetivo antes de eliminarlo definitivamente.");
      return repository.remove(goal.id, goal.version);
    },
  };
}
