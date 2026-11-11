import { dailySummary, consecutiveDays, motivation, celebration, summaryHistory } from "./summary.js";
import { createSummaryRepository } from "./summary-storage.js";
import { localDate } from "./goals.js";
import { validateDay } from "./agenda.js";

export function mountSummary() {
  const get = (id) => document.getElementById(id);
  const repository = createSummaryRepository();
  const formatter = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  let date = localDate();
  let followToday = true;
  let busy = false;
  let pending = false;
  let renderedDate = null;
  let channel;
  try { channel = new BroadcastChannel("enfoca-agenda"); } catch { /* Se conservan los eventos locales y la recarga al volver. */ }

  function setBusy(value) {
    busy = value;
    get("resumen").setAttribute("aria-busy", String(value));
    for (const control of get("resumen").querySelectorAll("button, input, select")) control.disabled = value;
  }
  function render(activities, claimed) {
    const today = localDate();
    const summary = dailySummary(activities, date);
    const streak = consecutiveDays(activities, date, today);
    const message = motivation(summary, streak);
    const congrats = celebration(summary);
    get("summary-date").value = date;
    get("summary-date-label").textContent = formatter.format(new Date(`${date}T12:00:00`));
    const values = { planned: summary.planned, completed: summary.completed, pending: summary.pending, skipped: summary.skipped, cancelled: summary.cancelled, "on-time": summary.completedOnTime, late: summary.completedLate, percentage: summary.percentage === null ? "—" : `${summary.percentage}%` };
    for (const [key, value] of Object.entries(values)) get(`summary-${key}`).textContent = String(value);
    get("summary-ratio").textContent = summary.required ? `${summary.completed} de ${summary.required} actividades exigibles completadas. ${summary.inProgress} en curso.` : "Sin actividades exigibles: no se calcula un porcentaje.";
    const progress = get("summary-progress");
    progress.hidden = summary.percentage === null;
    if (summary.percentage === null) progress.removeAttribute("aria-valuenow");
    else progress.setAttribute("aria-valuenow", String(summary.percentage));
    progress.firstElementChild.style.width = `${summary.percentage ?? 0}%`;
    get("summary-motivation").textContent = message.text;
    get("summary-motivation").dataset.kind = message.kind;
    get("summary-empty").hidden = summary.planned > 0;
    const detail = get("summary-celebration");
    if (renderedDate !== date || !congrats) detail.open = false;
    detail.hidden = !congrats;
    get("summary-celebration-title").textContent = congrats?.title || "";
    get("summary-celebration-text").textContent = congrats?.text || "";
    if (claimed && congrats) detail.open = true;
    const history = summaryHistory(activities, today);
    const selector = get("summary-history");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = history.length ? "Elige un día anterior" : "Sin días anteriores registrados";
    selector.replaceChildren(placeholder);
    for (const item of history) {
      const option = document.createElement("option");
      option.value = item.date;
      option.textContent = formatter.format(new Date(`${item.date}T12:00:00`));
      selector.append(option);
    }
    selector.value = history.some((item) => item.date === date) ? date : "";
    get("summary-content").hidden = false;
    get("summary-error").hidden = true;
    get("summary-error-text").textContent = "";
    get("summary-status").textContent = claimed ? "Has completado las actividades exigibles. La felicitación del día está abierta en el resumen." : "Resumen calculado desde las actividades guardadas en este dispositivo.";
    renderedDate = date;
  }
  async function load() {
    if (busy) { pending = true; return; }
    if (followToday) date = localDate();
    setBusy(true);
    get("summary-save-warning").hidden = true;
    get("summary-status").textContent = "Actualizando resumen…";
    try {
      const shouldClaim = date === localDate() && !document.hidden;
      let snapshot;
      try { snapshot = await repository.snapshot(date, { claim: shouldClaim }); }
      catch (error) {
        if (!shouldClaim) throw error;
        // Un fallo al guardar el marcador no convierte los datos en un día vacío.
        snapshot = await repository.snapshot(date);
        get("summary-save-warning").textContent = "No se pudo guardar el marcador de la felicitación automática. El resumen sigue disponible y puedes consultar el mensaje manualmente.";
        get("summary-save-warning").hidden = false;
      }
      render(snapshot.activities, snapshot.claimed);
    } catch (error) {
      get("summary-content").hidden = true;
      get("summary-celebration").open = false;
      get("summary-error-text").textContent = error.message;
      get("summary-error").hidden = false;
      get("summary-status").textContent = "No se pudo calcular el resumen. No se muestran cifras nuevas ni felicitaciones.";
    } finally {
      setBusy(false);
      if (pending) { pending = false; void load(); }
    }
  }
  async function select(value, follow = false) {
    if (busy) return;
    try { validateDay(value); }
    catch (error) { get("summary-status").textContent = error.message; get("summary-date").value = date; return; }
    date = value; followToday = follow;
    get("summary-content").hidden = true;
    await load();
  }
  get("summary-date").value = date;
  get("summary-date").addEventListener("change", () => void select(get("summary-date").value));
  get("summary-history").addEventListener("change", () => { if (get("summary-history").value) void select(get("summary-history").value); });
  get("summary-today").addEventListener("click", () => void select(localDate(), true));
  for (const [id, offset] of [["summary-previous", -1], ["summary-next", 1]]) get(id).addEventListener("click", () => {
    const next = new Date(`${date}T12:00:00`); next.setDate(next.getDate() + offset); void select(localDate(next));
  });
  get("summary-retry").addEventListener("click", () => void load());
  function refresh() { if (!document.hidden) void load(); }
  channel?.addEventListener("message", refresh);
  window.addEventListener("enfoca:activities-changed", refresh);
  window.addEventListener("pageshow", refresh);
  document.addEventListener("visibilitychange", refresh);
  window.setInterval(() => { if (followToday && date !== localDate()) refresh(); }, 30_000);
  void load();
}
