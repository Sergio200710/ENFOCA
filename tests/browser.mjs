// Prueba sin dependencias: servidor temporal local y perfil Chromium aislado.
// Ejecutar: node tests/browser.mjs [ruta al ejecutable Chrome/Edge]
import { createServer } from "node:http";
import { readFile, mkdtemp, rm, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const candidates = [process.argv[2], "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw new Error("No se encontró Chrome/Edge. Indica su ejecutable como argumento.");
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname === "/__test__") { res.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><html lang='es'><title>ENFOCA test</title></html>"); return; }
    const path = resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!path.startsWith(resolve(root) + sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(path);
    res.writeHead(200, { "Content-Type": ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" })[extname(path)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), "enfoca-browser-test-"));
let browser;
let socket;
let sequence = 0;
let sessionId;
const pending = new Map();
const errors = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  browser = spawn(executable, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Chromium no inició en 20 segundos")), 20_000);
    browser.once("error", (error) => { clearTimeout(timeout); reject(error); });
    browser.stderr.on("data", (data) => { const match = data.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails);
    const item = pending.get(message.id);
    if (item) { pending.delete(message.id); clearTimeout(item.timeout); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result); }
  });
  function command(method, params = {}, session = sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15_000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
    });
  }
  async function evaluate(expression) {
    const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async function wait(expression) {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await sleep(50); }
    throw new Error(`No se cumplió: ${expression}`);
  }
  function check(condition, message) { if (!condition) throw new Error(message); console.log(`PASS: ${message}`); }
  const target = await command("Target.createTarget", { url: "about:blank" }, null);
  sessionId = (await command("Target.attachToTarget", { targetId: target.targetId, flatten: true }, null)).sessionId;
  await command("Runtime.enable");
  await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await command("Page.navigate", { url: origin + "/__test__" });
  await wait(`location.pathname==='/__test__' && document.readyState==='complete'`);
  await evaluate(`(async()=>{
    window.legacyGoal={id:'migration-fixture',title:'Objetivo anterior',date:'1999-12-31',status:'completed',completedAt:'1999-12-31T12:00:00Z',archivedAt:'1999-12-31T13:00:00Z',deletedAt:null,createdAt:'1999-12-31T10:00:00Z',updatedAt:'1999-12-31T13:00:00Z',version:7,schemaVersion:1,syncState:'pending'};
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('enfoca',1);r.onupgradeneeded=()=>{const s=r.result.createObjectStore('goals',{keyPath:'id'});s.createIndex('date','date',{unique:false})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    await new Promise((resolve,reject)=>{const tx=db.transaction('goals','readwrite');tx.objectStore('goals').add(legacyGoal);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});db.close();
  })()`);
  await command("Page.navigate", { url: origin });
  const ready = `document.querySelector('#objetivos')?.getAttribute('aria-busy') === 'false' && !document.querySelector('#create-first-goal').disabled`;
  await wait(ready);
  await wait(`document.querySelector('#onboarding-dialog')?.open`);
  check(await evaluate(`document.querySelector('#onboarding-step-label').textContent==='Paso 1 de 6' && document.activeElement.id==='onboarding-title'`), "primera apertura: bienvenida con foco en la pregunta");
  check(await evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('enfoca');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});const version=db.version;const value=await new Promise((resolve,reject)=>{const r=db.transaction('goals').objectStore('goals').get('migration-fixture');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});db.close();return version===2&&value.version===7&&value.title==='Objetivo anterior'&&value.archivedAt==='1999-12-31T13:00:00Z'})()`), "migración v1 a v2 conserva el objetivo archivado y sus metadatos");
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  check(await evaluate(`document.activeElement.type==='checkbox'`), "teclado: Tab alcanza la primera opción nativa");
  await command("Input.dispatchKeyEvent", { type:"keyDown",key:" ",code:"Space",windowsVirtualKeyCode:32 });
  await command("Input.dispatchKeyEvent", { type:"keyUp",key:" ",code:"Space",windowsVirtualKeyCode:32 });
  check(await evaluate(`document.querySelector('#onboarding-goals-time').checked`), "teclado: Espacio selecciona una respuesta");
  await evaluate(`document.querySelector('#onboarding-goals-balance').click(); document.querySelector('#onboarding-form').requestSubmit(); document.querySelector('#onboarding-back').click()`);
  check(await evaluate(`document.querySelectorAll('#onboarding-question input:checked').length===2`), "avance y retroceso conservan respuestas múltiples");
  await evaluate(`document.querySelector('#onboarding-skip-question').click()`);
  check(await evaluate(`document.querySelector('#onboarding-step-label').textContent==='Paso 2 de 6'`), "omitir una pregunta permite avanzar");
  for(let i=0;i<4;i++)await evaluate(`document.querySelector('#onboarding-form').requestSubmit()`);
  await evaluate(`window.originalProfileTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(args[0]==='profiles'&&args[1]==='readwrite')throw new DOMException('forced quota','QuotaExceededError');return originalProfileTransaction.apply(this,args)};document.querySelector('#onboarding-form').requestSubmit()`);
  await wait(`document.querySelector('#onboarding-error').textContent.includes('No se ha guardado')`);
  check(await evaluate(`document.querySelector('#onboarding-dialog').open && document.querySelector('#onboarding-welcome').hidden`), "onboarding con fallo de guardado permanece abierto sin confirmar éxito");
  await evaluate(`IDBDatabase.prototype.transaction=window.originalProfileTransaction;document.querySelector('#onboarding-form').requestSubmit();document.querySelector('#onboarding-form').requestSubmit()`);
  await wait(`!document.querySelector('#onboarding-welcome').hidden`);
  check(await evaluate(`(async()=>{const {createProfileService,emptyAnswers}=await import('/assets/js/profile.js');const {createProfileRepository}=await import('/assets/js/profile-storage.js');const p=await createProfileService(createProfileRepository()).load();return p.onboardingStatus==='completed'&&JSON.stringify(p.answers)===JSON.stringify(emptyAnswers())&&p.version===1})()`), "finalización sin ninguna respuesta, sin duplicados por doble envío");
  await evaluate(`document.querySelector('#onboarding-enter').click()`);
  await command("Page.reload"); await wait(ready);
  await evaluate(`document.querySelector('#open-preferences').click()`);
  await wait(`document.querySelectorAll('#preferences-fields fieldset').length===6 && !document.querySelector('#preferences-save').disabled`);
  check(await evaluate(`!document.querySelector('#onboarding-dialog').open`), "recargar no repite el onboarding finalizado");
  await evaluate(`document.querySelector('#profile-goals-consistency').click();document.querySelector('#profile-goals-balance').click();document.querySelector('#profile-sport-regular').click();document.querySelector('#profile-procrastination-often').click();document.querySelector('#profile-wakeTime-hour').value='07';document.querySelector('#profile-wakeTime-minute').value='05';document.querySelector('#profile-bedTime-hour').value='23';document.querySelector('#profile-bedTime-minute').value='30';document.querySelector('#profile-reminders-before').click();document.querySelector('#preferences-form').requestSubmit();document.querySelector('#preferences-form').requestSubmit()`);
  await wait(`document.querySelector('#preferences-status').textContent==='Cambios guardados en este dispositivo.'`);
  check(await evaluate(`(async()=>{const {createProfileRepository}=await import('/assets/js/profile-storage.js');const p=await createProfileRepository().load();return p.version===2&&p.answers.wakeTime==='07:05'&&p.answers.bedTime==='23:30'&&p.answers.goals.length===2&&p.answers.sport==='regular'&&p.answers.reminders==='before'})()`), "perfil editable: guarda todas las respuestas y horarios normalizados sin duplicar");
  await evaluate(`document.querySelector('[data-question=sport] .clear-answer').click();document.querySelector('#preferences-form').requestSubmit()`);
  await wait(`document.querySelector('#preferences-status').textContent==='Cambios guardados en este dispositivo.'`);
  await evaluate(`document.querySelector('#preferences-close').click();document.querySelector('#open-preferences').click()`);
  await wait(`!document.querySelector('#preferences-save').disabled`);
  check(await evaluate(`!document.querySelector('#profile-sport-regular').checked&&document.querySelector('#profile-wakeTime-hour').value==='07'&&document.querySelector('#profile-goals-balance').checked`), "borrar una respuesta conserva las demás tras volver a abrir");
  await evaluate(`document.querySelector('#preferences-onboarding').click();document.querySelector('#onboarding-form').requestSubmit();document.querySelector('#onboarding-form').requestSubmit();document.querySelector('#onboarding-form').requestSubmit();document.querySelector('#onboarding-wakeTime-minute').value='';document.querySelector('#onboarding-form').requestSubmit()`);
  check(await evaluate(`document.querySelector('#onboarding-step-label').textContent==='Paso 4 de 6'&&document.querySelector('#onboarding-error').textContent.length>0`), "horario incompleto señala el error y permite omitirlo");
  await evaluate(`document.querySelector('#onboarding-skip-question').click();document.querySelector('#onboarding-back').click()`);
  check(await evaluate(`document.querySelector('#onboarding-wakeTime-hour').value===''&&document.querySelector('#onboarding-wakeTime-minute').value===''`), "omitir horario borra únicamente esa respuesta del borrador");
  await evaluate(`document.querySelector('#onboarding-skip').click()`);
  await wait(`!document.querySelector('#onboarding-dialog').open`);
  await command("Page.reload");await wait(ready);
  await evaluate(`document.querySelector('#open-preferences').click()`);
  await wait(`!document.querySelector('#preferences-save').disabled`);
  check(await evaluate(`document.querySelector('#preferences-status').textContent.includes('Omitiste')&&!document.querySelector('#onboarding-dialog').open`), "onboarding omitido no se repite y se puede retomar desde Preferencias");
  await evaluate(`window.originalProfilePut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const r=originalProfilePut.apply(this,args);if(this.name==='profiles')this.transaction.abort();return r};document.querySelector('#profile-sport-sometimes').click();document.querySelector('#preferences-form').requestSubmit()`);
  await wait(`document.querySelector('#preferences-status').textContent.includes('no se han guardado')`);
  check(await evaluate(`document.querySelector('#preferences-dialog').open&&!document.querySelector('#preferences-close').disabled`), "aborto real de transacción no confirma las preferencias como guardadas");
  await evaluate(`IDBObjectStore.prototype.put=window.originalProfilePut;document.querySelector('#preferences-close').click();document.querySelector('#open-preferences').click()`);
  await wait(`!document.querySelector('#preferences-save').disabled`);
  check(await evaluate(`!document.querySelector('#profile-sport-sometimes').checked`), "rollback de perfil conserva el último estado confirmado");
  await evaluate(`document.querySelector('#preferences-close').click()`);
  for (const width of [320,375,390,430,768]) {
    await command("Emulation.setDeviceMetricsOverride",{width,height:844,deviceScaleFactor:1,mobile:true});
    await evaluate(`document.querySelector('#open-preferences').click()`);
    await wait(`!document.querySelector('#preferences-save').disabled`);
    check(await evaluate(`(()=>{const d=document.querySelector('#preferences-dialog'),r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&d.scrollWidth<=d.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth})()`),`perfil sin desbordamiento a ${width}px`);
    await evaluate(`document.querySelector('#preferences-onboarding').click()`);
    if (width === 320) {
      await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      check(await evaluate(`getComputedStyle(document.querySelector('#onboarding-question .question-group')).animationName==='none'`), "movimiento reducido desactiva las transiciones");
      await command("Emulation.setEmulatedMedia", { features: [] });
    }
    for(let step=0;step<6;step++) {
      if(!await evaluate(`(()=>{const d=document.querySelector('#onboarding-dialog'),r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&d.scrollWidth<=d.clientWidth+1})()`))throw Error(`Onboarding layout ${width} step ${step+1}`);
      if(step<5)await evaluate(`document.querySelector('#onboarding-form').requestSubmit()`);
    }
    console.log(`PASS: seis pasos del onboarding dentro de pantalla a ${width}px`);
    await evaluate(`document.querySelector('#onboarding-skip').click()`);
    await wait(`!document.querySelector('#onboarding-dialog').open`);
  }
  check(await evaluate(`(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('enfoca');r.onsuccess=()=>resolve(r.result)});const count=await new Promise(resolve=>{const r=db.transaction('profiles').objectStore('profiles').count();r.onsuccess=()=>resolve(r.result)});db.close();return count===1})()`), "solo existe un perfil después de editar y repetir la bienvenida");
  await command("Emulation.setDeviceMetricsOverride", {width:390,height:844,deviceScaleFactor:1,mobile:true});
  check(await evaluate(`!document.querySelector('#empty-goals').hidden`), "estado vacío inicial");
  await evaluate(`document.querySelector('#create-first-goal').click(); document.querySelector('#goal-title').value='Leer diez páginas'; document.querySelector('#goal-form').requestSubmit(); document.querySelector('#goal-form').requestSubmit();`);
  await wait(`!document.querySelector('#goal-dialog').open`);
  check(await evaluate(`document.querySelectorAll('#goal-list li').length===1`), "creación sin duplicado por doble envío");
  await evaluate(`document.querySelector('[data-action=edit]').click(); document.querySelector('#goal-title').value='<img src=x onerror=alert(1)>'; document.querySelector('#goal-form').requestSubmit()`);
  await wait(`!document.querySelector('#goal-dialog').open`);
  check(await evaluate(`document.querySelector('.goal-title').textContent==='<img src=x onerror=alert(1)>' && !document.querySelector('#goal-list img')`), "edición sin inyección HTML");
  await evaluate(`document.querySelector('[data-action=toggle]').click()`);
  await wait(`document.querySelector('#progress-caption').textContent==='100% completado'`);
  console.log("PASS: completar y progreso del 100%");
  await evaluate(`document.querySelector('#add-goal').click(); document.querySelector('#goal-title').value='Segundo objetivo'; document.querySelector('#goal-form').requestSubmit()`);
  await wait(`document.querySelectorAll('#goal-list li').length===2`);
  check(await evaluate(`document.querySelector('#progress-caption').textContent==='50% completado'`), "porcentaje real del 50%");
  await evaluate(`document.querySelector('[data-action=archive]').click()`);
  await wait(`document.querySelectorAll('#archived-list li').length===1`);
  check(await evaluate(`document.querySelector('#progress-caption').textContent==='0% completado'`), "archivar excluye el objetivo del progreso");
  await evaluate(`document.querySelector('#archived-goals').open=true; document.querySelector('[data-action=restore]').click()`);
  await wait(`document.querySelector('#progress-caption').textContent==='50% completado'`);
  await evaluate(`document.querySelector('[data-action=toggle]').click()`);
  await wait(`document.querySelector('#progress-caption').textContent==='0% completado'`);
  console.log("PASS: restaurar y reabrir");
  await evaluate(`document.querySelectorAll('[data-action=archive]')[1].click()`);
  await wait(`document.querySelectorAll('#archived-list li').length===1`);
  await evaluate(`document.querySelector('#archived-goals').open=true; document.querySelector('[data-action=remove]').click(); document.querySelector('#cancel-delete').click()`);
  check(await evaluate(`!document.querySelector('#delete-dialog').open && document.querySelectorAll('#archived-list li').length===1`), "cancelar eliminación conserva el objetivo");
  await evaluate(`document.querySelector('[data-action=remove]').click(); document.querySelector('#confirm-delete').click(); document.querySelector('#confirm-delete').click()`);
  await wait(`!document.querySelector('#delete-dialog').open && document.querySelectorAll('#archived-list li').length===0`);
  console.log("PASS: eliminación confirmada");
  await command("Page.reload");
  await wait(ready);
  check(await evaluate(`document.querySelectorAll('#goal-list li').length===1 && document.querySelector('.goal-title').textContent==='<img src=x onerror=alert(1)>'`), "IndexedDB conserva datos tras recargar");

  const integration = await evaluate(`(async () => {
    const {createGoalRepository} = await import('/assets/js/storage.js');
    const {createGoalService,localDate} = await import('/assets/js/goals.js');
    const repository=createGoalRepository(); const service=createGoalService(repository);
    const today=localDate(); const original=(await service.list(today))[0];
    const outcomes=await Promise.allSettled([service.edit(original,'Edición A'),service.edit(original,'Edición B')]);
    if(outcomes.filter(x=>x.status==='fulfilled').length!==1 || outcomes.filter(x=>x.status==='rejected'&&x.reason.name==='ConflictError').length!==1) throw Error('No conflict protection');
    const current=(await service.list(today))[0];
    await repository.update(current.id,current.version,()=>{throw Error('forced abort')}).then(()=>{throw Error('Abort accepted')},()=>{});
    if((await service.list(today))[0].version!==current.version)throw Error('Rollback failed');
    await service.create('Otro día','2000-01-01');
    if((await service.list('2000-01-01')).length!==1 || (await service.list(today)).length!==1)throw Error('Date isolation failed');
    repository.close();
    if((await repository.list(today)).length!==1)throw Error('Reopen failed');
    repository.close();
    return true;
  })()`);
  check(integration, "IndexedDB real: conflicto concurrente, rollback, separación por fecha y reconexión");
  await evaluate(`document.querySelector('[data-action=edit]').click(); document.querySelector('#goal-title').value='No sobrescribir otra pestaña'; document.querySelector('#goal-form').requestSubmit()`);
  await wait(`document.querySelector('#goal-form-error').textContent.includes('otra pestaña')`);
  check(await evaluate(`document.querySelector('#goal-dialog').open && !document.querySelector('#cancel-goal').disabled`), "conflicto visible sin bloquear la cancelación del formulario");
  await evaluate(`document.querySelector('#cancel-goal').click(); document.querySelector('#retry-storage').click()`);
  await wait(`document.querySelector('#storage-error').hidden && document.querySelector('#objetivos').getAttribute('aria-busy')==='false'`);
  check(await evaluate(`document.querySelector('.goal-title').textContent==='Edición A' || document.querySelector('.goal-title').textContent==='Edición B'`), "recargar tras conflicto recupera la versión guardada");
  await command("Page.reload"); await wait(ready);
  await evaluate(`window.originalTransaction=IDBDatabase.prototype.transaction; IDBDatabase.prototype.transaction=function(...args){if(args[1]==='readwrite')throw new DOMException('forced quota','QuotaExceededError');return window.originalTransaction.apply(this,args)}; document.querySelector('#add-goal').click(); document.querySelector('#goal-title').value='No debe guardarse'; document.querySelector('#goal-form').requestSubmit()`);
  await wait(`document.querySelector('#goal-form-error').textContent.includes('No se ha guardado')`);
  check(await evaluate(`document.querySelector('#goal-dialog').open && document.querySelectorAll('#goal-list li').length===1 && !document.querySelector('#cancel-goal').disabled`), "cuota fallida no muestra un objetivo guardado y permite cancelar");
  await evaluate(`IDBDatabase.prototype.transaction=window.originalTransaction; document.querySelector('#cancel-goal').click()`);

  await evaluate(`window.RealDate=Date; window.testTomorrow=new RealDate(); testTomorrow.setDate(testTomorrow.getDate()+1); window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[testTomorrow.getTime()]))} static now(){return testTomorrow.getTime()}}; document.dispatchEvent(new Event('visibilitychange'))`);
  await wait(`!document.querySelector('#empty-goals').hidden && document.querySelector('#objetivos').getAttribute('aria-busy')==='false'`);
  check(await evaluate(`document.querySelectorAll('#goal-list li').length===0`), "cambio de día muestra sus propios objetivos sin borrar los anteriores");
  await evaluate(`window.Date=window.RealDate; document.dispatchEvent(new Event('visibilitychange'))`);
  await wait(`document.querySelectorAll('#goal-list li').length===1 && document.querySelector('#objetivos').getAttribute('aria-busy')==='false'`);
  await evaluate(`document.querySelector('[data-action=edit]').click(); document.querySelector('#goal-title').value='x'.repeat(160); document.querySelector('#goal-form').requestSubmit()`);
  await wait(`!document.querySelector('#goal-dialog').open`);
  for (const width of [320,375,390,430,768]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height:844,deviceScaleFactor:1,mobile:true });
    check(await evaluate(`document.documentElement.scrollWidth<=window.innerWidth`), `sin desbordamiento horizontal a ${width}px`);
    await evaluate(`document.querySelector('[data-action=edit]').click()`);
    check(await evaluate(`(()=>{const r=document.querySelector('#goal-dialog').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.height<=innerHeight})()`), `formulario dentro de pantalla a ${width}px`);
    await evaluate(`document.querySelector('#cancel-goal').click()`);
  }
  check(errors.length===0, "sin excepciones JavaScript no controladas en Chromium");
  const denied = await command("Page.addScriptToEvaluateOnNewDocument", { source: `window.deniedOriginalOpen=IDBFactory.prototype.open;IDBFactory.prototype.open=function(){throw new DOMException('denied','SecurityError')}` });
  await command("Page.reload");
  await wait(`document.querySelector('#storage-error') && !document.querySelector('#storage-error').hidden`);
  check(await evaluate(`document.querySelector('#empty-goals').hidden && document.querySelector('#completed-count').textContent==='—' && !document.querySelector('#retry-storage').disabled`), "almacenamiento denegado no se presenta como un día vacío y permite reintentar");
  await wait(`document.querySelector('#preferences-error').textContent.length>0`);
  check(await evaluate(`document.querySelector('#preferences-dialog').open&&document.querySelector('#preferences-save').disabled&&!document.querySelector('#onboarding-dialog').open&&document.querySelectorAll('#preferences-fields fieldset').length===0`),"error al leer perfil no se confunde con primera apertura ni con respuestas vacías");
  await evaluate(`IDBFactory.prototype.open=window.deniedOriginalOpen;document.querySelector('#preferences-retry').click()`);
  await wait(`!document.querySelector('#preferences-save').disabled`);
  check(await evaluate(`document.querySelectorAll('#preferences-fields fieldset').length===6&&document.querySelector('#preferences-error').textContent===''`),"reintentar preferencias recupera el perfil tras un error de lectura");
  await command("Page.removeScriptToEvaluateOnNewDocument", { identifier: denied.identifier });
  await command("Page.reload");
  await wait(ready);
  check(await evaluate(`document.querySelectorAll('#goal-list li').length===1`), "recuperación del acceso conserva los datos existentes");
  check(errors.length===0, "sin excepciones no controladas al finalizar todas las pruebas");
  await command("Browser.close", {}, null);
} finally {
  socket?.close();
  if (browser && browser.exitCode===null) {
    await Promise.race([new Promise((resolve)=>browser.once('exit',resolve)),sleep(3000)]);
    if(browser.exitCode===null)browser.kill();
  }
  await new Promise((resolve)=>server.close(resolve));
  // Solo elimina el perfil temporal creado por esta ejecución.
  if(resolve(profile).startsWith(resolve(tmpdir())+sep) && profile.includes('enfoca-browser-test-')) await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:250});
}
