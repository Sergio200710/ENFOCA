import { dailyProgress } from "./goals.js";

export function createGoalsUI({ onSave, onAction, onRetry }) {
  const get = (id) => document.getElementById(id);
  const section = get("objetivos");
  const editor = get("goal-dialog");
  const deletion = get("delete-dialog");
  const form = get("goal-form");
  let editing = null;
  let deleting = null;
  let editorDate;
  let busy = false;
  let currentState;

  function openEditor(goal = null) {
    if (busy || !currentState?.loaded || currentState.error) return;
    editing = goal;
    editorDate = currentState.date;
    form.reset();
    get("goal-form-error").textContent = "";
    get("goal-dialog-title").textContent = goal ? "Editar objetivo" : "Nuevo objetivo";
    get("goal-day-label").textContent = `Objetivo del ${new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long" }).format(new Date(`${editorDate}T12:00:00`))}`;
    get("goal-title").value = goal?.title || "";
    editor.showModal();
    get("goal-title").focus();
  }
  function setBusy(value) {
    busy = value;
    section.setAttribute("aria-busy", String(value));
    for (const control of document.querySelectorAll("#objetivos button, #goal-dialog button, #goal-dialog input, #delete-dialog button")) control.disabled = value || !currentState?.loaded || Boolean(currentState.error);
    get("retry-storage").disabled = value;
    get("cancel-goal").disabled = value;
    get("cancel-delete").disabled = value;
    get("save-goal").textContent = value ? "Guardando…" : "Guardar objetivo";
  }
  function button(label, action, goal) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = action === "remove" ? "text-button danger-text" : "text-button";
    element.textContent = label;
    element.setAttribute("aria-label", `${label}: ${goal.title}`);
    element.dataset.action = action;
    element.dataset.goalId = goal.id;
    element.addEventListener("click", () => {
      if (busy) return;
      if (action === "edit") openEditor(goal);
      else if (action === "remove") {
        deleting = goal;
        get("delete-goal-title").textContent = goal.title;
        get("delete-error").textContent = "";
        deletion.showModal();
        get("cancel-delete").focus();
      } else onAction(action, goal);
    });
    return element;
  }
  function row(goal, archived) {
    const item = document.createElement("li");
    item.className = `card goal-item${goal.status === "completed" ? " is-completed" : ""}`;
    const title = document.createElement("h3");
    title.className = "goal-title";
    title.textContent = goal.title;
    const status = document.createElement("p");
    status.className = "goal-state";
    status.textContent = goal.status === "completed" ? "Completado" : "Pendiente";
    const actions = document.createElement("div");
    actions.className = "goal-actions";
    if (archived) actions.append(button("Restaurar", "restore", goal), button("Eliminar definitivamente", "remove", goal));
    else actions.append(button(goal.status === "completed" ? "Reabrir" : "Completar", "toggle", goal), button("Editar", "edit", goal), button("Archivar", "archive", goal));
    item.append(title, status, actions);
    return item;
  }
  function render(state) {
    currentState = state;
    const available = state.loaded;
    const goals = state.goals.filter((goal) => goal.date === state.date && !goal.deletedAt);
    const active = goals.filter((goal) => !goal.archivedAt);
    const archived = goals.filter((goal) => goal.archivedAt);
    const progress = dailyProgress(goals, state.date);
    get("completed-count").textContent = available ? String(progress.completed) : "—";
    get("progress-total").textContent = available ? `de ${progress.total} objetivos` : "objetivos";
    get("progress-caption").textContent = !available ? "Progreso no disponible" : progress.total ? `${progress.percentage}% completado` : "Sin objetivos todavía";
    get("progress-badge").textContent = !available ? "Sin datos" : !progress.total ? "Primer paso" : progress.percentage === 100 ? "¡Lo has logrado!" : "A tu ritmo";
    get("progress-fill").style.width = `${available ? progress.percentage : 0}%`;
    if (available) get("daily-progress").setAttribute("aria-valuenow", String(progress.percentage));
    else get("daily-progress").removeAttribute("aria-valuenow");
    get("goal-count").textContent = available ? String(active.length) : "—";
    get("goal-count").setAttribute("aria-label", available ? `${active.length} objetivos activos` : "Objetivos no disponibles");
    get("empty-goals").hidden = !available || active.length > 0;
    get("add-goal").hidden = !available || active.length === 0;
    get("goal-list").replaceChildren(...active.map((goal) => row(goal, false)));
    get("archived-list").replaceChildren(...archived.map((goal) => row(goal, true)));
    get("archived-goals").hidden = !available || archived.length === 0;
    get("archive-summary").textContent = `Archivados de hoy (${archived.length})`;
    get("storage-error").hidden = !state.error;
    get("storage-error-text").textContent = state.error || "";
    get("goals-status").textContent = state.message || "";
    setBusy(state.busy);
  }
  get("create-first-goal").addEventListener("click", () => openEditor());
  get("add-goal").addEventListener("click", () => openEditor());
  get("retry-storage").addEventListener("click", onRetry);
  get("cancel-goal").addEventListener("click", () => { if (!busy) editor.close(); });
  get("cancel-delete").addEventListener("click", () => { if (!busy) deletion.close(); });
  for (const dialog of [editor, deletion]) dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!busy) onSave({ goal: editing, title: get("goal-title").value, date: editorDate });
  });
  get("confirm-delete").addEventListener("click", () => { if (!busy && deleting) onAction("remove", deleting); });
  return {
    render,
    closeEditor() { editor.close(); },
    closeDelete() { deletion.close(); },
    formError(message) { get("goal-form-error").textContent = message; },
    deleteError(message) { get("delete-error").textContent = message; },
    dayChanged() { editor.close(); deletion.close(); },
    focusAction(id, action) {
      const target = [...section.querySelectorAll("button[data-goal-id]")].find((element) => element.dataset.goalId === id && element.dataset.action === action);
      (target || (get("add-goal").hidden ? get("create-first-goal") : get("add-goal"))).focus();
    },
  };
}
