"use strict";

// Aumentar RELEASE siempre que cambie HTML, CSS, módulos, manifest o iconos.
// Cada versión sirve un conjunto coherente de recursos, incluido index.html.
const RELEASE = "1.0.0";
const BASE = new URL("./", self.registration.scope);
const CACHE_PREFIX = `enfoca-pwa:${encodeURIComponent(BASE.pathname)}:`;
const CACHE_NAME = `${CACHE_PREFIX}${RELEASE}`;
const FILES = [
  "index.html", "manifest.json", "assets/css/style.css",
  "assets/js/app.js", "assets/js/pwa.js", "assets/js/pwa-policy.js",
  "assets/js/storage.js", "assets/js/goals.js", "assets/js/ui.js",
  "assets/js/profile.js", "assets/js/profile-storage.js", "assets/js/profile-ui.js",
  "assets/js/agenda.js", "assets/js/agenda-storage.js", "assets/js/agenda-ui.js",
  "assets/js/summary.js", "assets/js/summary-storage.js", "assets/js/summary-ui.js",
  "assets/img/icon-192.png", "assets/img/icon-512.png",
  "assets/img/apple-touch-icon.png", "assets/img/enfoca-icon.svg",
];
const URLS = FILES.map((file) => new URL(file, BASE).href);
const ALLOWED = new Set(URLS);
const INDEX = new URL("index.html", BASE).href;

function expectedType(url, response) {
  const type = response.headers.get("Content-Type")?.split(";")[0].trim();
  const path = new URL(url).pathname;
  if (path.endsWith(".js")) return ["text/javascript", "application/javascript"].includes(type);
  if (path.endsWith(".html")) return type === "text/html";
  if (path.endsWith(".css")) return type === "text/css";
  if (path.endsWith(".json")) return ["application/json", "application/manifest+json"].includes(type);
  if (path.endsWith(".png")) return type === "image/png";
  return type === "image/svg+xml";
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    // Primero descarga y valida TODO. Una respuesta HTML de error no sustituye
    // un módulo JS. Un fallo conserva el worker activo y su caché anterior.
    const resources = await Promise.all(URLS.map(async (url) => {
      const response = await fetch(new Request(url, { cache: "reload", credentials: "same-origin", redirect: "error" }));
      if (!response.ok || response.redirected || !expectedType(url, response)) throw new Error("Recurso estático no válido para preparar ENFOCA offline.");
      return [url, response];
    }));
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(resources.map(([url, response]) => cache.put(url, response)));
    // No skipWaiting automático: las actualizaciones esperan al usuario.
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const source = event.source?.url && new URL(event.source.url);
  if (!source || source.origin !== BASE.origin || !source.pathname.startsWith(BASE.pathname)) return;
  if (event.data?.type === "ACTIVATE_UPDATE") event.waitUntil(self.skipWaiting());
  if (event.data?.type === "OFFLINE_STATUS" && event.ports[0]) {
    event.waitUntil((async () => {
      let ready = false;
      if (await caches.has(CACHE_NAME)) {
        const cache = await caches.open(CACHE_NAME);
        ready = (await Promise.all(URLS.map((url) => cache.match(url)))).every(Boolean);
      }
      event.ports[0].postMessage({ ready, release: RELEASE });
    })());
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Lista cerrada: nunca intercepta API, búsquedas con query, externos, POST,
  // Authorization ni recursos ajenos. No existe caché de datos del usuario.
  if (request.method !== "GET" || url.origin !== BASE.origin || url.search || request.headers.has("Authorization") || request.headers.has("Range")) return;
  const shell = request.mode === "navigate" && (url.href === BASE.href || url.href === INDEX);
  if (!shell && !ALLOWED.has(url.href)) return;
  const key = shell ? INDEX : url.href;
  event.respondWith((async () => {
    // Cache-first para el shell, módulos, CSS, manifest e iconos: todos de la
    // misma RELEASE. Sin revalidaciones que mezclen versiones. El navegador
    // comprueba el worker sin caché HTTP; la UI ofrece la actualización.
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(key);
    if (cached) return cached;
    // Una caché eliminada por el navegador no se repuebla parcialmente con
    // recursos de una versión distinta. Solo una instalación completa la crea.
    try { return await fetch(request); }
    catch {
      if (shell) return new Response("<!doctype html><html lang='es'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>ENFOCA sin conexión</title><body><h1>ENFOCA</h1><p>No están disponibles todos los recursos offline. Conecta el dispositivo y vuelve a abrir la aplicación.</p><p>No se han borrado tus datos locales.</p></body></html>", { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
      return new Response("Recurso de ENFOCA no disponible sin conexión.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  })());
});
