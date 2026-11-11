import { createActivityRepository } from "./agenda-storage.js";
import { createActivityService, ACTIVITY_STATES, punctuality, overlapSignature, sortActivities, validateDay } from "./agenda.js";
import { createGoalRepository } from "./storage.js";
import { localDate } from "./goals.js";

const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
function formatInstant(value, zone) {
  if (!value) return "Sin registrar";
  return new Intl.DateTimeFormat("es-ES", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

export function mountAgenda() {
  const get = (id) => document.getElementById(id);
  const service = createActivityService(createActivityRepository());
  const goals = createGoalRepository();
  const editor = get("activity-dialog");
  const deletion = get("activity-delete-dialog");
  const state = { date: localDate(), activities: [], goals: [], loaded: false, busy: false, error: "", message: "Cargando agenda…" };
  let editing = null;
  let removing = null;
  let formLoaded = false;
  let conflicts = [];
  let followToday = true;
  let refreshPending = false;
  let channel;
  let goalChannel;
  try { channel = new BroadcastChannel("enfoca-agenda"); goalChannel = new BroadcastChannel("enfoca-goals"); } catch { /* También se recarga al volver a la página. */ }

  // Selectores explícitos 00–23 / 00–59 para no depender del formato del SO.
  for (const [kind, label] of [["start", "Inicio programado"], ["end", "Finalización programada"]]) {
    const fieldset = node("fieldset", "question-group");
    fieldset.append(node("legend", "", label));
    const pair = node("div", "time-selects");
    for (const [unit, limit, caption] of [["hour", 24, "Hora (00–23)"], ["minute", 60, "Minutos (00–59)"]]) {
      const wrapper = node("div");
      const select = node("select");
      select.id = `activity-${kind}-${unit}`;
      select.required = true;
      select.setAttribute("aria-describedby", "activity-schedule-help");
      const labelNode = node("label", "", caption);
      labelNode.htmlFor = select.id;
      const empty = node("option", "", "Sin elegir"); empty.value = ""; select.append(empty);
      for (let i = 0; i < limit; i++) { const value = String(i).padStart(2, "0"); const option = node("option", "", value); option.value = value; select.append(option); }
      wrapper.append(labelNode, select); pair.append(wrapper);
    }
    fieldset.append(pair); get("activity-times").append(fieldset);
  }

  function setBusy(value) {
    state.busy = value;
    get("agenda").setAttribute("aria-busy", String(value));
    for (const control of document.querySelectorAll("#agenda button, #agenda input")) control.disabled = value || !state.loaded || Boolean(state.error);
    get("agenda-retry").disabled = value;
    // La navegación por fechas sigue disponible después de una lectura fallida.
    for (const id of ["agenda-date", "agenda-previous", "agenda-next", "agenda-today"]) get(id).disabled = value;
    for (const control of editor.querySelectorAll("button, input, select")) control.disabled = value;
    get("activity-save").disabled = value || !formLoaded || Boolean(state.error);
    const locked = editing && editing.status !== "scheduled";
    for (const id of ["activity-date", "activity-start-hour", "activity-start-minute", "activity-end-hour", "activity-end-minute"]) get(id).disabled = value || Boolean(locked);
    for (const control of deletion.querySelectorAll("button")) control.disabled = value;
    get("activity-save").textContent = value ? "Guardando…" : "Guardar actividad";
  }
  function focusActivity(id) {
    const target = [...get("activity-list").querySelectorAll("button")].find((button) => button.dataset.activityId === id);
    (target || get("agenda-create")).focus();
  }
  function actionButton(label, action, activity) {
    const button = node("button", action === "remove" ? "text-button danger-text" : "text-button", label);
    button.type = "button"; button.dataset.activityId = activity.id; button.dataset.activityAction = action;
    button.setAttribute("aria-label", `${label}: ${activity.title}`);
    button.addEventListener("click", () => {
      if (state.busy) return;
      if (action === "edit") void openEditor(activity);
      else if (action === "remove") {
        removing = activity;
        get("activity-delete-name").textContent = activity.title;
        get("activity-delete-error").textContent = "";
        deletion.showModal(); get("activity-delete-cancel").focus();
      } else void persist(() => service.transition(activity, action), "action", activity.id);
    });
    return button;
  }
  function activityRow(activity, removed = false) {
    const item = node("li", "card activity-item"); item.dataset.activityId = activity.id;
    item.append(node("p", "activity-hours", `${activity.schedule.startTime} – ${activity.schedule.endTime}`), node("h3", "goal-title", activity.title));
    item.append(node("p", "goal-state", ACTIVITY_STATES[activity.status]));
    const timing = punctuality(activity);
    if (timing.startDelayMs !== null) item.append(node("p", "activity-timing", timing.startDelayMs ? `Inicio con ${Math.ceil(timing.startDelayMs / 1000)} s de retraso.` : "Inicio puntual o anticipado."));
    if (timing.endDelayMs > 0) item.append(node("p", "activity-timing", `Final con ${Math.ceil(timing.endDelayMs / 1000)} s de retraso.`));
    if (activity.goalId) {
      const linked = state.goals.find((goal) => goal.id === activity.goalId);
      item.append(node("p", "archive-note", linked ? `Objetivo: ${linked.title}${linked.archivedAt ? " (archivado)" : ""}` : "Objetivo vinculado no disponible; se conserva su referencia."));
    }
    const detail = node("details", "activity-detail");
    detail.append(node("summary", "", "Consultar horario e historial"));
    const data = node("dl", "activity-data");
    for (const [label, value] of [["Fecha planificada", activity.schedule.date], ["Zona horaria del plan", activity.schedule.timeZone], ["Inicio programado", activity.schedule.startTime], ["Finalización programada", activity.schedule.endTime], ["Inicio real", formatInstant(activity.actualStartAt, activity.schedule.timeZone)], ["Finalización real", formatInstant(activity.actualEndAt, activity.schedule.timeZone)]]) data.append(node("dt", "", label), node("dd", "", value));
    detail.append(data);
    const history = node("ol", "schedule-history");
    activity.scheduleHistory.forEach((entry, index) => history.append(node("li", "", `${index === 0 ? "Horario original" : "Reprogramación"}: ${entry.schedule.date}, ${entry.schedule.startTime}–${entry.schedule.endTime} (${entry.schedule.timeZone}). Registrado: ${formatInstant(entry.changedAt, entry.schedule.timeZone)}.`)));
    detail.append(history);
    const events = node("ul", "schedule-history");
    const eventNames = { start: "Inicio manual", finish: "Finalización manual", skip: "Omisión manual", cancel: "Cancelación manual", edited: "Edición", rescheduled: "Cambio de programación", removed: "Eliminación de la agenda" };
    for (const event of activity.stateHistory) events.append(node("li", "", `${eventNames[event.type] || "Cambio"}: ${formatInstant(event.at, activity.schedule.timeZone)}.`));
    detail.append(events); item.append(detail);
    if (!removed) {
      const actions = node("div", "goal-actions");
      if (activity.status === "scheduled") actions.append(actionButton("Iniciar ahora", "start", activity), actionButton("Omitir", "skip", activity));
      if (activity.status === "in_progress") actions.append(actionButton("Finalizar ahora", "finish", activity));
      if (["scheduled", "in_progress"].includes(activity.status)) actions.append(actionButton("Cancelar actividad", "cancel", activity));
      actions.append(actionButton("Editar", "edit", activity), actionButton("Eliminar", "remove", activity));
      item.append(actions);
    }
    return item;
  }
  function render() {
    get("agenda-date").value = state.date;
    const active = sortActivities(state.activities.filter((activity) => activity.schedule.date === state.date && !activity.deletedAt));
    const removed = sortActivities(state.activities.filter((activity) => activity.schedule.date === state.date && activity.deletedAt));
    get("activity-list").replaceChildren(...active.map((activity) => activityRow(activity)));
    get("activity-removed-list").replaceChildren(...removed.map((activity) => activityRow(activity, true)));
    get("agenda-removed").hidden = !removed.length;
    get("agenda-removed-summary").textContent = `Eliminadas de la agenda (${removed.length})`;
    get("agenda-empty").hidden = !state.loaded || active.length > 0;
    get("agenda-error").hidden = !state.error;
    get("agenda-error-text").textContent = state.error;
    get("agenda-status").textContent = state.message;
    setBusy(state.busy);
  }
  async function load() {
    if (state.busy) { refreshPending = true; return; }
    state.error = ""; state.message = "Cargando agenda…"; state.busy = true; render();
    try {
      const [activities, linkedGoals] = await Promise.all([service.list(state.date), goals.listAll()]);
      state.activities = activities; state.goals = linkedGoals; state.loaded = true;
      state.message = "Agenda guardada en este dispositivo. Las horas reales solo se registran con tus acciones.";
    } catch (error) {
      state.error = error.message; state.message = "No se pudo actualizar la agenda. No se han guardado cambios.";
    } finally { state.busy = false; render(); drainRefresh(); }
  }
  function drainRefresh() {
    if (refreshPending && !state.busy) { refreshPending = false; void load(); }
  }
  async function selectDate(value, follow = false) {
    if (state.busy) return;
    try { validateDay(value); }
    catch (error) { state.message = error.message; render(); return; }
    followToday = follow;
    state.date = value; state.activities = []; state.loaded = false;
    await load();
  }
  function readForm() {
    const clock = (kind) => `${get(`activity-${kind}-hour`).value}:${get(`activity-${kind}-minute`).value}`;
    return { title: get("activity-title").value, date: get("activity-date").value, startTime: clock("start"), endTime: clock("end"), goalId: get("activity-goal").value || null };
  }
  async function openEditor(activity = null) {
    if (state.busy || !state.loaded || state.error) return;
    editing = activity; formLoaded = false; conflicts = [];
    get("activity-form").reset(); get("activity-overlap").hidden = true;
    get("activity-form-error").textContent = "";
    get("activity-dialog-title").textContent = activity ? "Editar actividad" : "Nueva actividad";
    get("activity-title").value = activity?.title || "";
    get("activity-date").value = activity?.schedule.date || state.date;
    for (const [kind, time] of [["start", activity?.schedule.startTime], ["end", activity?.schedule.endTime]]) {
      get(`activity-${kind}-hour`).value = time?.slice(0, 2) || "";
      get(`activity-${kind}-minute`).value = time?.slice(3, 5) || "";
    }
    get("activity-schedule-help").textContent = activity && activity.status !== "scheduled" ? `Horario fijado en ${activity.schedule.timeZone}. Solo puedes cambiar el título o el vínculo al objetivo.` : "Final posterior al inicio, dentro del mismo día. Un cambio guardado se añade al historial. Zona horaria del dispositivo.";
    editor.showModal(); setBusy(true);
    try {
      const all = await goals.listAll(); state.goals = all;
      const select = get("activity-goal");
      const blank = node("option", "", "Sin objetivo vinculado"); blank.value = ""; select.replaceChildren(blank);
      for (const goal of all.filter((item) => !item.deletedAt && (!item.archivedAt || item.id === activity?.goalId))) {
        const option = node("option", "", `${goal.title} · ${goal.date}${goal.archivedAt ? " (archivado)" : ""}`); option.value = goal.id; select.append(option);
      }
      if (activity?.goalId && !all.some((goal) => goal.id === activity.goalId)) { const option = node("option", "", "Objetivo anterior no disponible (conservar vínculo)"); option.value = activity.goalId; select.append(option); }
      select.value = activity?.goalId || ""; formLoaded = true;
    } catch (error) { get("activity-form-error").textContent = `${error.message} Vuelve a abrir el formulario para reintentar.`; }
    finally { setBusy(false); get("activity-title").focus(); }
  }
  async function persist(work, source, id) {
    if (state.busy) return;
    state.message = "Guardando actividad…"; state.busy = true; render();
    get("activity-form-error").textContent = ""; get("activity-delete-error").textContent = "";
    let saved = false;
    try {
      const activity = await work();
      state.activities = state.activities.filter((item) => item.id !== activity.id);
      if (activity.schedule.date === state.date) state.activities.push(activity);
      state.error = ""; state.message = "Actividad guardada en este dispositivo."; saved = true; id = activity.id;
      if (source === "form") editor.close();
      if (source === "delete") deletion.close();
      try { channel?.postMessage("changed"); } catch { /* Escritura confirmada igualmente. */ }
    } catch (error) {
      const message = `${error.message} No se ha guardado la operación.`;
      state.message = message;
      if (source === "form") {
        get("activity-form-error").textContent = message;
        if (error.name === "OverlapError") {
          conflicts = error.conflicts;
          get("activity-overlap-list").replaceChildren(...conflicts.map((item) => node("li", "", `${item.title}: ${item.schedule.startTime}–${item.schedule.endTime} (${item.schedule.timeZone})`)));
          get("activity-overlap").hidden = false; get("activity-overlap-confirm").checked = false;
        }
      }
      if (source === "delete") get("activity-delete-error").textContent = message;
      if (error.name === "ConflictError") state.error = message;
    } finally {
      state.busy = false; render();
      if (saved) focusActivity(id);
      drainRefresh();
    }
  }
  get("activity-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (state.busy || !formLoaded || state.error) return;
    const input = readForm();
    const consent = get("activity-overlap-confirm").checked ? overlapSignature(conflicts) : "";
    void persist(() => editing ? service.edit(editing, input, consent) : service.create(input, consent), "form", editing?.id);
  });
  for (const event of ["input", "change"]) get("activity-form").addEventListener(event, (e) => {
    if (e.target.id !== "activity-overlap-confirm") { conflicts = []; get("activity-overlap").hidden = true; get("activity-overlap-confirm").checked = false; }
  });
  get("agenda-create").addEventListener("click", () => void openEditor());
  get("activity-form-cancel").addEventListener("click", () => { if (!state.busy) { editor.close(); focusActivity(editing?.id); } });
  get("activity-delete-cancel").addEventListener("click", () => { if (!state.busy) { deletion.close(); focusActivity(removing?.id); } });
  get("activity-delete-confirm").addEventListener("click", () => { if (!state.busy && removing) void persist(() => service.remove(removing), "delete", removing.id); });
  for (const dialog of [editor, deletion]) dialog.addEventListener("cancel", (event) => { if (state.busy) event.preventDefault(); });
  get("agenda-retry").addEventListener("click", () => void load());
  get("agenda-date").addEventListener("change", () => void selectDate(get("agenda-date").value));
  get("agenda-today").addEventListener("click", () => void selectDate(localDate(), true));
  for (const [id, offset] of [["agenda-previous", -1], ["agenda-next", 1]]) get(id).addEventListener("click", () => {
    const date = new Date(`${state.date}T12:00:00`); date.setDate(date.getDate() + offset); void selectDate(localDate(date));
  });
  function refresh() {
    if (document.hidden) return;
    if (state.busy) { refreshPending = true; return; }
    if (followToday && state.date !== localDate()) { void selectDate(localDate(), true); return; }
    void load();
  }
  channel?.addEventListener("message", refresh); goalChannel?.addEventListener("message", refresh);
  document.addEventListener("visibilitychange", refresh); window.addEventListener("pageshow", refresh);
  window.setInterval(() => { if (followToday && state.date !== localDate()) refresh(); }, 30_000);
  get("agenda-date").value = state.date;
  void load();
}
