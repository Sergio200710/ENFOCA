import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import vm from "node:vm";
import { inflateSync } from "node:zlib";
import { needsIphoneInstallHelp, mayReloadForUpdate } from "../assets/js/pwa-policy.js";

const source = await readFile(new URL("../service-worker.js", import.meta.url), "utf8");
function worker(overrides = {}) {
  const listeners = {};
  const deleted = [];
  const scope = "https://enfoca.test/ENFOCA/";
  let skipped = 0;
  const context = vm.createContext({ URL, Request, Response, Headers, Set, Promise,
    self: { registration: { scope }, addEventListener(name, fn) { listeners[name] = fn; }, clients: { async claim() {} }, async skipWaiting() { skipped++; } },
    caches: { async keys() { return []; }, async delete(name) { deleted.push(name); }, async open() { return { async match() { return new Response("cached"); }, async put() {} }; } },
    fetch: async () => new Response("network"), ...overrides });
  vm.runInContext(source, context);
  return { listeners, context, deleted, get skipped() { return skipped; }, policy: vm.runInContext("({FILES,CACHE_NAME,CACHE_PREFIX,URLS})", context) };
}
test.skip("PENDIENTE fase 7: manifest integrado y rutas relativas para raíz y subcarpeta", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.name, "ENFOCA"); assert.equal(manifest.short_name, "ENFOCA");
  assert.equal(manifest.display, "standalone"); assert.equal(manifest.theme_color, "#101B2B"); assert.equal(manifest.background_color, "#101B2B");
  for (const path of ["/", "/ENFOCA/"]) {
    const url = `https://enfoca.test${path}manifest.json`;
    assert.equal(new URL(manifest.start_url, url).pathname, path);
    assert.equal(new URL(manifest.scope, url).pathname, path);
  }
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /rel="manifest" href="manifest.json"/);
  assert.match(html, /rel="apple-touch-icon" sizes="180x180"/);
});
test("PNG propios válidos, dimensiones y paleta correctas", async () => {
  for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
    const png = await readFile(new URL(`../assets/img/${name}`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
    const data = []; let offset = 8;
    while (offset < png.length) { const length = png.readUInt32BE(offset); const type = png.toString("ascii", offset + 4, offset + 8); if (type === "IDAT") data.push(png.subarray(offset + 8, offset + 8 + length)); offset += 12 + length; }
    const pixels = inflateSync(Buffer.concat(data));
    assert.equal(pixels.length, size * (size * 3 + 1));
    assert.deepEqual([...pixels.subarray(1, 4)], [16, 27, 43]);
  }
});
test("precache incluye todos los módulos y recursos existentes", async () => {
  const { policy } = worker();
  for (const file of await readdir(new URL("../assets/js/", import.meta.url))) if (file.endsWith(".js")) assert.ok(policy.FILES.includes(`assets/js/${file}`), `${file} no está en precache`);
  for (const file of policy.FILES) await readFile(new URL(`../${file}`, import.meta.url));
  assert.equal(new Set(policy.FILES).size, policy.FILES.length);
});
test("fetch usa lista cerrada y nunca intercepta externos, API, consultas ni escrituras", async () => {
  const { listeners } = worker();
  for (const [url, method, headers] of [["https://external.test/assets/js/app.js", "GET", {}], ["https://enfoca.test/ENFOCA/api/private", "GET", {}], ["https://enfoca.test/ENFOCA/manifest.json?private=1", "GET", {}], ["https://enfoca.test/ENFOCA/index.html", "POST", {}], ["https://enfoca.test/ENFOCA/manifest.json", "GET", { Authorization: "fixture" }], ["https://enfoca.test/other/", "GET", {}]]) {
    let intercepted = false;
    listeners.fetch({ request: { url, method, headers: new Headers(headers), mode: "same-origin" }, respondWith() { intercepted = true; } });
    assert.equal(intercepted, false, url);
  }
});
test("shell y módulos se sirven desde su caché sin necesitar red", async () => {
  let calls = 0;
  const { listeners } = worker({ fetch: async () => { calls++; throw Error("offline"); } });
  for (const [path, mode] of [["", "navigate"], ["assets/js/app.js", "same-origin"]]) {
    let response;
    listeners.fetch({ request: { url: `https://enfoca.test/ENFOCA/${path}`, method: "GET", headers: new Headers(), mode }, respondWith(promise) { response = promise; } });
    assert.equal(await (await response).text(), "cached");
  }
  assert.equal(calls, 0);
});
test("activación limpia únicamente versiones antiguas de ENFOCA en el mismo scope", async () => {
  const fixture = worker(); const prefix = fixture.policy.CACHE_PREFIX; const removed = [];
  const { listeners } = worker({ caches: { async keys() { return [prefix + "old", fixture.policy.CACHE_NAME, "another-app", "enfoca-pwa:%2Fother%2F:old"]; }, async delete(name) { removed.push(name); } } });
  let activation; listeners.activate({ waitUntil(value) { activation = value; } }); await activation;
  assert.deepEqual(removed, [prefix + "old"]);
});
test("instalación incompleta no activa el worker ni sobrescribe una caché anterior", async () => {
  let writes = 0;
  const fixture = worker({ fetch: async () => new Response("unavailable", { status: 503 }), caches: { async open() { writes++; } } });
  let installation; fixture.listeners.install({ waitUntil(value) { installation = value; } });
  await assert.rejects(installation, /Recurso estático/);
  assert.equal(writes, 0); assert.equal(fixture.skipped, 0);
});
test("solo una petición explícita de un cliente del scope activa una actualización", async () => {
  const fixture = worker();
  fixture.listeners.message({ source: { url: "https://external.test/" }, data: { type: "ACTIVATE_UPDATE" } });
  assert.equal(fixture.skipped, 0);
  let activation;
  fixture.listeners.message({ source: { url: "https://enfoca.test/ENFOCA/" }, data: { type: "ACTIVATE_UPDATE" }, waitUntil(value) { activation = value; } });
  await activation; assert.equal(fixture.skipped, 1);
});
test("ayuda de instalación exclusiva de Safari en iPhone sin instalar", () => {
  const safari = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
  assert.equal(needsIphoneInstallHelp({ userAgent: safari }), true);
  assert.equal(needsIphoneInstallHelp({ userAgent: safari, standalone: true }), false);
  for (const userAgent of [safari + " CriOS/123", safari + " FxiOS/123", "Mozilla/5.0 Windows Chrome/123 Safari/537", "Mozilla/5.0 Macintosh Version/18 Safari/605"]) assert.equal(needsIphoneInstallHelp({ userAgent }), false);
  assert.equal(mayReloadForUpdate({ querySelector: () => ({}) }), false);
  assert.equal(mayReloadForUpdate({ querySelector: () => null }), true);
});
