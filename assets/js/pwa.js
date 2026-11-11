import { needsIphoneInstallHelp, mayReloadForUpdate } from "./pwa-policy.js";

export function mountPWA() {
  const get = (id) => document.getElementById(id);
  const status = get("pwa-status");
  const updateButton = get("pwa-update");
  const retry = get("pwa-retry");
  let registration;
  let applying = false;
  let reloadOnChange = false;
  const workerURL = new URL("../../service-worker.js", import.meta.url).href;
  let controlled = navigator.serviceWorker?.controller?.scriptURL === workerURL;
  let lastCheck = 0;

  function installHelp() {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    get("iphone-install-help").hidden = !needsIphoneInstallHelp({ userAgent: navigator.userAgent, standalone });
  }
  function connectionStatus() {
    get("pwa-network").hidden = navigator.onLine;
    get("pwa-network").textContent = "Sin conexión. Tus cambios siguen guardándose en este dispositivo.";
  }
  function offerUpdate(reload = false) {
    get("pwa-update-note").hidden = false;
    get("pwa-update-note").textContent = reload ? "La nueva versión está lista. Guarda o cierra los formularios antes de recargar." : "Hay una nueva versión disponible. Guarda o cierra los formularios antes de actualizar.";
    updateButton.hidden = false;
    updateButton.textContent = reload ? "Recargar ENFOCA" : "Actualizar ENFOCA";
  }
  async function checkOffline() {
    const worker = registration?.active;
    if (!worker) return;
    const result = await new Promise((resolve) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => { channel.port1.close(); resolve(null); }, 4000);
      channel.port1.onmessage = (event) => { clearTimeout(timeout); channel.port1.close(); resolve(event.data); };
      try { worker.postMessage({ type: "OFFLINE_STATUS" }, [channel.port2]); }
      catch { clearTimeout(timeout); channel.port1.close(); resolve(null); }
    });
    status.textContent = result?.ready ? "ENFOCA está lista para usar sin conexión." : "No se ha podido confirmar que todos los recursos estén disponibles sin conexión. Vuelve a abrir ENFOCA con conexión.";
    status.dataset.offlineReady = String(Boolean(result?.ready));
  }
  function watch(worker) {
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed") {
        if (navigator.serviceWorker.controller?.scriptURL === workerURL) offerUpdate();
      }
      if (worker.state === "activated") void checkOffline();
      if (worker.state === "redundant" && !registration.active) {
        status.textContent = "No se pudo preparar el modo sin conexión. Puedes reintentarlo con conexión.";
        retry.hidden = false;
      }
    });
  }
  async function register() {
    retry.hidden = true;
    if (!window.isSecureContext || !["http:", "https:"].includes(location.protocol)) {
      status.textContent = "Para preparar el modo sin conexión, abre ENFOCA mediante HTTPS o desde localhost.";
      return;
    }
    if (!("serviceWorker" in navigator)) {
      status.textContent = "Este navegador no admite el modo sin conexión de ENFOCA.";
      return;
    }
    try {
      registration = await navigator.serviceWorker.register(new URL("../../service-worker.js", import.meta.url), { scope: new URL("../../", import.meta.url).href, updateViaCache: "none" });
      watch(registration.installing);
      registration.addEventListener("updatefound", () => watch(registration.installing));
      if (registration.waiting) offerUpdate();
      if (registration.active) await checkOffline();
      else status.textContent = "Preparando los recursos para usar ENFOCA sin conexión…";
    } catch {
      status.textContent = "No se pudo preparar el modo sin conexión. La aplicación no ha borrado tus datos locales.";
      retry.hidden = false;
    }
  }
  async function checkForUpdate() {
    if (!registration || !navigator.onLine || document.hidden || Date.now() - lastCheck < 60_000) return;
    lastCheck = Date.now();
    try { await registration.update(); } catch { /* La edición activa sigue disponible. */ }
  }
  navigator.serviceWorker?.addEventListener("controllerchange", () => {
    if (reloadOnChange) { window.location.reload(); return; }
    if (controlled) offerUpdate(true);
    controlled = true;
    void checkOffline();
  });
  updateButton.addEventListener("click", () => {
    if (applying) return;
    if (!mayReloadForUpdate(document)) {
      get("pwa-update-note").textContent = "Termina o cancela los formularios abiertos y espera a que finalice el guardado antes de actualizar.";
      return;
    }
    if (!registration?.waiting) { window.location.reload(); return; }
    applying = true; updateButton.disabled = true; reloadOnChange = true;
    registration.waiting.postMessage({ type: "ACTIVATE_UPDATE" });
  });
  retry.addEventListener("click", () => void register());
  window.addEventListener("offline", connectionStatus);
  window.addEventListener("online", () => { connectionStatus(); void checkForUpdate(); });
  window.addEventListener("appinstalled", installHelp);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { installHelp(); connectionStatus(); void checkOffline(); void checkForUpdate(); } });
  window.setInterval(() => void checkForUpdate(), 60 * 60 * 1000);
  installHelp(); connectionStatus(); void register();
}
