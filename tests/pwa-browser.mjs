export async function runPWABrowserTests({ command, evaluate, wait, check, origin, networkResponses, setRelease }) {
  const ready = `document.querySelector('#pwa-status')?.dataset.offlineReady==='true'&&navigator.serviceWorker.controller&&['objetivos','agenda','resumen'].every(id=>document.getElementById(id).getAttribute('aria-busy')==='false')`;
  const offline = (value, session) => command('Network.emulateNetworkConditions', { offline: value, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, session);
  async function snapshot() {
    return evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('enfoca');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});const data={version:db.version};for(const name of db.objectStoreNames){data[name]=await new Promise((resolve,reject)=>{const r=db.transaction(name).objectStore(name).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}db.close();return JSON.stringify(data)})()`);
  }
  await wait(ready);
  const manifest = await command('Page.getAppManifest');
  check(manifest.errors.length===0&&JSON.parse(manifest.data).name==='ENFOCA','Chrome carga el manifest sin errores');
  check(await evaluate(`navigator.serviceWorker.controller.scriptURL===new URL('service-worker.js',location.href).href`),'service worker registrado y controlando ENFOCA');
  check(await evaluate(`document.querySelector('#iphone-install-help').hidden`),'Chrome de escritorio no muestra instrucciones de iPhone');
  const cacheName = await evaluate(`(async()=> (await caches.keys()).find(name=>name.startsWith('enfoca-pwa:%2F:')))()`);
  if(!cacheName)throw Error('Caché de ENFOCA no encontrada');
  const scriptUrls = await evaluate(`(async()=>{const cache=await caches.open(${JSON.stringify(cacheName)});return (await cache.keys()).map(r=>r.url).filter(url=>url.endsWith('.js'))})()`);
  await command('Network.enable');
  await command('Network.setCacheDisabled',{cacheDisabled:true});
  await command('Network.clearBrowserCache');
  networkResponses.length=0;
  await offline(true);
  await command('Page.reload');await wait(ready);
  check(await evaluate(`!navigator.onLine&&!document.querySelector('#pwa-network').hidden`),'recarga sin red con estado offline comprensible');
  check(scriptUrls.every(url=>networkResponses.some(response=>response.url===url&&response.fromServiceWorker)),'todos los módulos JS se cargan desde el worker sin caché HTTP ni conexión');
  for(const target of ['agenda','objetivos','resumen','inicio']) {
    await evaluate(`document.querySelector('nav a[href="#${target}"]').click()`);
    check(await evaluate(`location.hash==='#${target}'`),`navegación offline a ${target}`);
  }
  const oldProfile = await evaluate(`(async()=>{const {createProfileRepository}=await import('/assets/js/profile-storage.js');return (await createProfileRepository().load()).answers})()`);
  await evaluate(`(document.querySelector('#add-goal').hidden?document.querySelector('#create-first-goal'):document.querySelector('#add-goal')).click();document.querySelector('#goal-title').value='Objetivo offline';document.querySelector('#goal-form').requestSubmit()`);
  await wait(`!document.querySelector('#goal-dialog').open`);
  const goalId=await evaluate(`(async()=>{const {createGoalRepository}=await import('/assets/js/storage.js');return (await createGoalRepository().listAll()).find(g=>g.title==='Objetivo offline').id})()`);
  await evaluate(`document.querySelector('#agenda-date').value='2044-03-03';document.querySelector('#agenda-date').dispatchEvent(new Event('change'))`);
  await wait(`document.querySelector('#agenda').getAttribute('aria-busy')==='false'&&!document.querySelector('#agenda-create').disabled`);
  await evaluate(`document.querySelector('#agenda-create').click()`);
  await wait(`document.querySelector('#activity-dialog').open&&!document.querySelector('#activity-save').disabled`);
  await evaluate(`document.querySelector('#activity-title').value='Actividad offline';document.querySelector('#activity-start-hour').value='08';document.querySelector('#activity-start-minute').value='00';document.querySelector('#activity-end-hour').value='09';document.querySelector('#activity-end-minute').value='00';document.querySelector('#activity-goal').value=${JSON.stringify(goalId)};document.querySelector('#activity-form').requestSubmit()`);
  await wait(`!document.querySelector('#activity-dialog').open`);
  await evaluate(`document.querySelector('[data-activity-action=edit]').click()`);
  await wait(`document.querySelector('#activity-dialog').open&&!document.querySelector('#activity-save').disabled`);
  await evaluate(`document.querySelector('#activity-title').value='Actividad offline editada';document.querySelector('#activity-start-minute').value='30';document.querySelector('#activity-end-minute').value='30';document.querySelector('#activity-form').requestSubmit()`);
  await wait(`!document.querySelector('#activity-dialog').open`);
  check(await evaluate(`document.querySelector('#activity-list .goal-title').textContent==='Actividad offline editada'&&document.querySelector('#activity-list .schedule-history').children.length===2`),'crear y reprogramar una actividad offline conserva su historial');
  await evaluate(`document.querySelector('[data-activity-action=start]').click()`);
  await wait(`Boolean(document.querySelector('[data-activity-action=finish]'))`);
  await evaluate(`document.querySelector('[data-activity-action=finish]').click()`);
  await wait(`document.querySelector('#activity-list .goal-state').textContent.startsWith('Completada')`);
  await evaluate(`document.querySelector('#summary-date').value='2044-03-03';document.querySelector('#summary-date').dispatchEvent(new Event('change'))`);
  await wait(`document.querySelector('#resumen').getAttribute('aria-busy')==='false'&&document.querySelector('#summary-completed').textContent==='1'`);
  check(await evaluate(`document.querySelector('#summary-percentage').textContent==='100%'&&!document.querySelector('#summary-content').hidden`),'registro manual y resumen diario funcionan offline');
  await evaluate(`document.querySelector('#open-preferences').click()`);
  await wait(`document.querySelector('#preferences-dialog').open&&!document.querySelector('#preferences-save').disabled`);
  await evaluate(`document.querySelector('#profile-reminders-at-time').click();document.querySelector('#preferences-form').requestSubmit()`);
  await wait(`document.querySelector('#preferences-status').textContent==='Cambios guardados en este dispositivo.'`);
  await evaluate(`document.querySelector('#preferences-close').click()`);
  await command('Page.reload');await wait(ready);
  check(await evaluate(`(async()=>{const {createGoalRepository}=await import('/assets/js/storage.js');const {createActivityRepository}=await import('/assets/js/agenda-storage.js');const all=await createGoalRepository().listAll();const activity=(await createActivityRepository().list('2044-03-03'))[0];return all.some(g=>g.id===${JSON.stringify(goalId)})&&activity.title==='Actividad offline editada'&&activity.actualStartAt!==null&&activity.actualEndAt!==null&&activity.goalId===${JSON.stringify(goalId)}})()`),'objetivo, vínculo y horas reales persisten tras recargar offline');
  const newProfile=await evaluate(`(async()=>{const {createProfileRepository}=await import('/assets/js/profile-storage.js');return (await createProfileRepository().load()).answers})()`);
  check(newProfile.reminders==='at-time'&&JSON.stringify({...newProfile,reminders:oldProfile.reminders})===JSON.stringify(oldProfile),'perfil guardado offline conserva el resto de respuestas');
  for(const width of [320,375,390,430,768]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
    check(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),`PWA offline sin desbordamiento a ${width}px`);
  }
  await offline(false);
  check(await evaluate(`(async()=>{const r=await fetch('/api/private',{headers:{Authorization:'Bearer fixture'}});const names=await caches.keys();for(const name of names){const c=await caches.open(name);if((await c.keys()).some(r=>r.url.includes('/api/')))return false}return r.ok})()`),'respuestas de una futura API privada no se añaden a caché');
  const prefix=cacheName.slice(0,cacheName.lastIndexOf(':')+1);
  await evaluate(`(async()=>{await caches.open('another-app-v1');await caches.open('enfoca-pwa:%2Fother%2F:old');await caches.open(${JSON.stringify(prefix+'obsolete')})})()`);
  const beforeUpdate=await snapshot();
  setRelease('1.0.1-test-update');
  await evaluate(`(async()=>{await (await navigator.serviceWorker.getRegistration()).update()})()`);
  await wait(`!document.querySelector('#pwa-update').hidden`);
  await wait(`(async()=>Boolean((await navigator.serviceWorker.getRegistration()).waiting))()`);
  await evaluate(`document.querySelector('#add-goal').click();document.querySelector('#goal-title').value='Borrador sin guardar';document.querySelector('#pwa-update').click()`);
  check(await evaluate(`document.querySelector('#goal-dialog').open&&document.querySelector('#goal-title').value==='Borrador sin guardar'&&document.querySelector('#pwa-update-note').textContent.includes('Termina o cancela')`),'actualización bloqueada con formulario abierto y borrador intacto');
  await evaluate(`document.querySelector('#cancel-goal').click();document.querySelector('#pwa-update').click()`);
  await wait(`(async()=>{const names=await caches.keys();return names.includes(${JSON.stringify(prefix+'1.0.1-test-update')})&&!names.includes(${JSON.stringify(cacheName)})})()`);
  await wait(ready);
  await wait(`(async()=> (await caches.keys()).includes(${JSON.stringify(prefix+'1.0.1-test-update')}))()`);
  check(await snapshot()===beforeUpdate,'actualización del worker conserva íntegramente IndexedDB');
  check(await evaluate(`(async()=>{const names=await caches.keys();return names.filter(n=>n.startsWith(${JSON.stringify(prefix)})).length===1&&names.includes('another-app-v1')&&names.includes('enfoca-pwa:%2Fother%2F:old')})()`),'activación elimina solo cachés antiguas de ENFOCA en su scope');
  await offline(true);await command('Page.reload');await wait(ready);
  check(await snapshot()===beforeUpdate,'la nueva versión vuelve a abrir offline conservando los datos');
  await offline(false);

  // Mismo código servido bajo /ENFOCA/: manifiesto, módulos y worker relativos.
  let targetId;
  try {
    targetId=(await command('Target.createTarget',{url:origin+'/ENFOCA/'},null)).targetId;
    const session=(await command('Target.attachToTarget',{targetId,flatten:true},null)).sessionId;
    const evalChild=async(expression)=>{const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},session);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
    async function waitChild() {for(let i=0;i<150;i++){if(await evalChild(ready))return;await new Promise(r=>setTimeout(r,50))}throw Error('PWA en subcarpeta no está lista')}
    await waitChild();
    const childManifest=await command('Page.getAppManifest',{},session);
    check(childManifest.errors.length===0&&await evalChild(`navigator.serviceWorker.controller.scriptURL===location.origin+'/ENFOCA/service-worker.js'`),'manifest y service worker funcionan bajo /ENFOCA/');
    await command('Network.enable',{},session);await command('Network.setCacheDisabled',{cacheDisabled:true},session);
    await offline(true,session);await command('Page.reload',{},session);await waitChild();
    check(await evalChild(`location.pathname==='/ENFOCA/'&&!navigator.onLine&&!document.querySelector('#iphone-install-help').open`),'subcarpeta carga todos sus módulos offline');
  } finally {if(targetId)await command('Target.closeTarget',{targetId},null)}
}
