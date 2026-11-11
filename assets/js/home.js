import { createActivityRepository } from "./agenda-storage.js";
import { localDate } from "./goals.js";

// Vista de solo lectura: no modifica horarios, estados ni datos de la agenda.
export function mountHome() {
  const repository = createActivityRepository();
  const status = document.getElementById("home-activity-status");
  const title = document.getElementById("home-activity-name");
  const time = document.getElementById("home-activity-time");
  let sequence = 0;
  async function refresh() {
    const request = ++sequence;
    try {
      const items = (await repository.list(localDate())).filter(item => !item.deletedAt);
      if (request !== sequence) return;
      const planned = items.filter(item => item.status === "scheduled").sort((a,b) => a.schedule.startTime.localeCompare(b.schedule.startTime));
      const now = new Date();
      const wallTime = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
      const activity = items.find(item => item.status === "in_progress") || planned.find(item => item.schedule.startTime >= wallTime) || planned[0];
      title.textContent = activity?.title || "Un espacio para lo importante";
      time.textContent = activity ? `${activity.schedule.startTime} – ${activity.schedule.endTime}` : "";
      status.textContent = !activity ? "No tienes actividades pendientes para hoy." : activity.status === "in_progress" ? "En curso · horario planificado" : activity.schedule.startTime < wallTime ? "Pendiente de iniciar · horario planificado" : "Próxima actividad · horario planificado";
    } catch {
      if (request !== sequence) return;
      title.textContent = ""; time.textContent = "";
      status.textContent = "No se ha podido consultar la agenda. Ábrela para volver a cargarla.";
    }
  }
  try { new BroadcastChannel("enfoca-agenda").addEventListener("message", refresh); } catch { /* Se actualiza al recuperar visibilidad. */ }
  window.addEventListener("enfoca:activities-changed", refresh);
  window.addEventListener("pageshow", refresh);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
  window.setInterval(refresh, 30_000);
  void refresh();
}
