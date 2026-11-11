import { createGoalRepository } from "./storage.js";
import { createGoalService, localDate } from "./goals.js";
import { createGoalsUI } from "./ui.js";
import { mountProfile } from "./profile-ui.js";

const service = createGoalService(createGoalRepository());
const state = { date: localDate(), goals: [], loaded: false, busy: false, error: "", message: "Cargando objetivos…" };
const formatter = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
let channel;
try { channel = new BroadcastChannel("enfoca-goals"); } catch { /* Se conserva la recarga al recuperar visibilidad. */ }
const ui = createGoalsUI({ onSave: save, onAction: action, onRetry: load });

function updateWelcome() {
  const now = new Date();
  const hour = now.getHours();
  document.getElementById("greeting").textContent = hour >= 6 && hour < 12 ? "Buenos días." : hour >= 12 && hour < 21 ? "Buenas tardes." : "Buenas noches.";
  const date = document.getElementById("current-date");
  date.textContent = formatter.format(now);
  date.dateTime = localDate(now);
  if (state.date !== date.dateTime && !state.busy) {
    state.date = date.dateTime;
    state.goals = [];
    state.loaded = false;
    ui.dayChanged();
    return true;
  }
  return false;
}
async function load() {
  if (state.busy) return;
  updateWelcome();
  const day = state.date;
  state.busy = true;
  state.error = "";
  state.message = "Cargando objetivos…";
  ui.render(state);
  try {
    const goals = await service.list(day);
    state.goals = goals.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    state.loaded = true;
    state.message = "Objetivos guardados en este dispositivo.";
  } catch (error) {
    state.error = error.message;
    state.message = state.loaded ? "Se muestran los últimos datos leídos. No se han guardado cambios nuevos." : "No se han podido cargar tus objetivos.";
  } finally {
    state.busy = false;
    ui.render(state);
    if (updateWelcome()) void load();
  }
}
async function persist(work, { source, id, nextAction, success }) {
  if (state.busy) return;
  state.busy = true;
  state.message = "Guardando en este dispositivo…";
  ui.render(state);
  ui.formError("");
  ui.deleteError("");
  let saved = false;
  try {
    const goal = await work();
    if (goal) {
      const index = state.goals.findIndex((item) => item.id === goal.id);
      if (index < 0) state.goals.push(goal);
      else state.goals[index] = goal;
    } else state.goals = state.goals.filter((item) => item.id !== id);
    state.error = "";
    state.message = success;
    saved = true;
    if (source === "editor") {
      ui.closeEditor();
      id = goal.id;
      nextAction = "edit";
    }
    if (source === "delete") ui.closeDelete();
    try { channel?.postMessage("changed"); } catch { /* La escritura ya está confirmada. */ }
  } catch (error) {
    const message = `${error.message} No se ha guardado la operación.`;
    state.message = message;
    if (source === "editor") ui.formError(message);
    if (source === "delete") ui.deleteError(message);
    if (error.name === "ConflictError") state.error = message;
  } finally {
    state.busy = false;
    ui.render(state);
    if (updateWelcome()) void load();
    else if (saved && nextAction && !state.error) ui.focusAction(id, nextAction);
  }
}
async function save({ goal, title, date }) {
  if (state.busy) return;
  if (updateWelcome() || date !== state.date) {
    ui.dayChanged();
    await load();
    state.message = "Ha cambiado el día. Abre de nuevo el formulario para crear un objetivo de hoy.";
    ui.render(state);
    return;
  }
  await persist(() => goal ? service.edit(goal, title) : service.create(title, date), { source: "editor", success: "Objetivo guardado en este dispositivo." });
}
async function action(type, goal) {
  if (state.busy) return;
  if (updateWelcome()) { await load(); return; }
  const commands = {
    toggle: () => service.setCompleted(goal, goal.status !== "completed"),
    archive: () => service.archive(goal),
    restore: () => service.restore(goal),
    remove: () => service.remove(goal),
  };
  const messages = { toggle: goal.status === "completed" ? "Objetivo reabierto." : "Objetivo completado.", archive: "Objetivo archivado. Puedes restaurarlo en Archivados de hoy.", restore: "Objetivo restaurado.", remove: "Objetivo eliminado definitivamente de este dispositivo." };
  await persist(commands[type], { id: goal.id, source: type === "remove" ? "delete" : "list", nextAction: type === "toggle" ? "toggle" : "edit", success: messages[type] });
}
function refresh() {
  updateWelcome();
  if (!document.hidden && !state.busy) void load();
}
channel?.addEventListener("message", refresh);
document.addEventListener("visibilitychange", refresh);
window.addEventListener("pageshow", refresh);
window.setInterval(() => { if (updateWelcome()) void load(); }, 30_000);
updateWelcome();
void load();
mountProfile();
