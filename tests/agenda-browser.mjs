import { createServer } from "node:http";

// Origen y base temporales independientes para comprobar v2 → v3 sin borrar
// las fixtures del resto de la suite ni acceder a perfiles reales del navegador.
export async function checkVersionTwoMigration({ command, check, requestHandler }) {
  const server = createServer(requestHandler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let targetId;
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    targetId = (await command("Target.createTarget", { url: origin + "/__test__" }, null)).targetId;
    const session = (await command("Target.attachToTarget", { targetId, flatten: true }, null)).sessionId;
    const evaluate = async (expression) => {
      const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, session);
      if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      return response.result.value;
    };
    for (let i=0;i<100;i++) { if(await evaluate(`document.readyState==='complete'&&location.pathname==='/__test__'`))break;await new Promise(r=>setTimeout(r,50)); }
    const before = await evaluate(`(async()=>{
      const goal={id:crypto.randomUUID(),title:'Fixture conservada',date:'2001-01-01',status:'pending',version:3,createdAt:'2001-01-01T00:00:00Z'};
      const profile={id:'local',schemaVersion:1,version:5,onboardingStatus:'skipped',createdAt:'2001-01-01T00:00:00Z',updatedAt:'2001-01-01T00:00:00Z',syncState:'pending',answers:{goals:['time','balance'],sport:'sometimes',procrastination:'rarely',wakeTime:'07:05',bedTime:'23:30',reminders:'hourly'}};
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('enfoca',2);r.onupgradeneeded=()=>{r.result.createObjectStore('goals',{keyPath:'id'}).createIndex('date','date');r.result.createObjectStore('profiles',{keyPath:'id'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
      await new Promise((resolve,reject)=>{const tx=db.transaction(['goals','profiles'],'readwrite');tx.objectStore('goals').add(goal);tx.objectStore('profiles').add(profile);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});db.close();return {goal,profile};
    })()`);
    await command("Page.navigate", { url: origin }, session);
    for(let i=0;i<100;i++){if(await evaluate(`document.querySelector('#agenda')?.getAttribute('aria-busy')==='false'&&!document.querySelector('#agenda-create').disabled`))break;await new Promise(r=>setTimeout(r,50));}
    const after = await evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('enfoca');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});const get=(store)=>new Promise(resolve=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result[0])});const result={version:db.version,stores:[...db.objectStoreNames],goal:await get('goals'),profile:await get('profiles')};db.close();return result})()`);
    check(after.version===3&&after.stores.includes('activities')&&JSON.stringify(before.goal)===JSON.stringify(after.goal)&&JSON.stringify(before.profile)===JSON.stringify(after.profile),'migración v2 a v3 conserva íntegramente objetivo y perfil');
  } finally {
    if(targetId)await command('Target.closeTarget',{targetId},null);
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
}

export async function runAgendaBrowserTests({ command, evaluate, wait, check }) {
  const day = "2031-05-20";
  const ready = `document.querySelector('#agenda').getAttribute('aria-busy')==='false'&&!document.querySelector('#agenda-create').disabled`;
  async function selectDay(date) {
    await evaluate(`document.querySelector('#agenda-date').value=${JSON.stringify(date)};document.querySelector('#agenda-date').dispatchEvent(new Event('change'))`);
    await wait(ready);
  }
  async function form(title, start, end, goalId = "") {
    await wait(`document.querySelector('#activity-dialog').open&&!document.querySelector('#activity-save').disabled`);
    await evaluate(`document.querySelector('#activity-title').value=${JSON.stringify(title)};document.querySelector('#activity-start-hour').value=${JSON.stringify(start.slice(0,2))};document.querySelector('#activity-start-minute').value=${JSON.stringify(start.slice(3))};document.querySelector('#activity-end-hour').value=${JSON.stringify(end.slice(0,2))};document.querySelector('#activity-end-minute').value=${JSON.stringify(end.slice(3))};document.querySelector('#activity-goal').value=${JSON.stringify(goalId)};`);
  }
  async function create(title, start, end, goalId = "") {
    await evaluate(`document.querySelector('#agenda-create').click()`);
    await form(title,start,end,goalId);
    await evaluate(`document.querySelector('#activity-form').requestSubmit();document.querySelector('#activity-form').requestSubmit()`);
    await wait(`!document.querySelector('#activity-dialog').open`);
  }
  async function clock(value) {
    await evaluate(`window.AgendaNativeDate??=Date;window.agendaTimestamp=new AgendaNativeDate(${JSON.stringify(value)}).getTime();window.Date=class extends AgendaNativeDate{constructor(...args){super(...(args.length?args:[window.agendaTimestamp]))}static now(){return window.agendaTimestamp}}`);
  }
  const before = await evaluate(`(async()=>{const {createGoalRepository}=await import('/assets/js/storage.js');const {createProfileRepository}=await import('/assets/js/profile-storage.js');return JSON.stringify({goals:await createGoalRepository().listAll(),profile:await createProfileRepository().load()})})()`);
  await wait(ready);await selectDay(day);
  check(await evaluate(`!document.querySelector('#agenda-empty').hidden`),'agenda vacía para la fecha consultada');
  await create('Actividad posterior','12:00','13:00');
  const linkedId = await evaluate(`(async()=>{const {createGoalRepository}=await import('/assets/js/storage.js');return (await createGoalRepository().listAll()).find(g=>!g.archivedAt&&!g.deletedAt).id})()`);
  await create('Actividad principal','09:00','10:00',linkedId);
  check(await evaluate(`document.querySelectorAll('#activity-list>li').length===2&&document.querySelector('#activity-list .activity-hours').textContent==='09:00 – 10:00'`),'crear sin duplicados y ordenar cronológicamente');
  await evaluate(`document.querySelector('#agenda-create').click()`);await form('Inválida','15:00','14:00');
  await evaluate(`document.querySelector('#activity-form').requestSubmit()`);
  await wait(`document.querySelector('#activity-form-error').textContent.includes('posterior')`);
  check(await evaluate(`document.querySelectorAll('#activity-list>li').length===2`),'horario inválido no se guarda');
  await evaluate(`document.querySelector('#activity-form-cancel').click();document.querySelector('#agenda-create').click()`);await form('Solapada','09:30','10:30');
  await evaluate(`document.querySelector('#activity-form').requestSubmit()`);
  await wait(`!document.querySelector('#activity-overlap').hidden`);
  check(await evaluate(`document.querySelectorAll('#activity-list>li').length===2&&!document.querySelector('#activity-overlap-confirm').checked`),'solapamiento requiere consentimiento explícito');
  await evaluate(`document.querySelector('#activity-overlap-confirm').click();document.querySelector('#activity-form').requestSubmit()`);
  await wait(`!document.querySelector('#activity-dialog').open`);
  check(await evaluate(`document.querySelectorAll('#activity-list>li').length===3`),'solapamiento intencionado se guarda al confirmarlo');
  await evaluate(`document.querySelectorAll('[data-activity-action=edit]')[2].click()`);await form('Actividad reprogramada','11:00','12:00');
  await evaluate(`document.querySelector('#activity-form').requestSubmit()`);await wait(`!document.querySelector('#activity-dialog').open`);
  check(await evaluate(`document.querySelectorAll('#activity-list .schedule-history')[4].textContent.includes('12:00–13:00')&&document.querySelectorAll('#activity-list .schedule-history')[4].textContent.includes('11:00–12:00')`),'editar conserva el horario original y la reprogramación');
  await clock(`${day}T09:00:00`);
  await evaluate(`document.querySelector('[data-activity-action=start]').click()`);await wait(`document.querySelector('#activity-list .goal-state').textContent==='En curso'`);
  await evaluate(`document.querySelector('[data-activity-action=edit]').click()`);await wait(`document.querySelector('#activity-dialog').open&&!document.querySelector('#activity-save').disabled`);
  check(await evaluate(`document.querySelector('#activity-date').disabled&&document.querySelector('#activity-start-hour').disabled`),'horario bloqueado tras iniciar');
  await evaluate(`document.querySelector('#activity-form-cancel').click()`);await clock(`${day}T10:00:00`);
  await evaluate(`document.querySelector('[data-activity-action=finish]').click()`);await wait(`document.querySelector('#activity-list .goal-state').textContent==='Completada puntualmente'`);
  check(await evaluate(`document.querySelector('#activity-list .activity-data').textContent.includes('09:00:00')&&document.querySelector('#activity-list .activity-data').textContent.includes('10:00:00')`),'inicio y final reales conservados en una actividad puntual');
  await clock(`${day}T10:05:00`);await evaluate(`document.querySelector('[data-activity-action=start]').click()`);
  await wait(`document.querySelectorAll('#activity-list .goal-state')[1].textContent==='En curso'`);
  await clock(`${day}T10:20:00`);await evaluate(`document.querySelector('[data-activity-action=finish]').click()`);
  await wait(`document.querySelectorAll('#activity-list .goal-state')[1].textContent==='Completada con retraso'`);
  console.log('PASS: retraso de inicio clasificado sin desplazar las horas programadas');
  await evaluate(`document.querySelector('[data-activity-action=skip]').click()`);await wait(`document.querySelectorAll('#activity-list .goal-state')[2].textContent==='Omitida'`);
  await create('Para cancelar','14:00','15:00');
  await evaluate(`document.querySelector('[data-activity-action=cancel]').click()`);await wait(`document.querySelectorAll('#activity-list .goal-state')[3].textContent==='Cancelada'`);
  check(await evaluate(`document.querySelectorAll('#activity-list .activity-data')[2].textContent.includes('Sin registrar')&&document.querySelectorAll('#activity-list .activity-data')[3].textContent.includes('Sin registrar')`),'omitir y cancelar no inventan ejecución');
  await evaluate(`document.querySelectorAll('[data-activity-action=remove]')[3].click();document.querySelector('#activity-delete-cancel').click()`);
  check(await evaluate(`document.querySelectorAll('#activity-list>li').length===4`),'cancelar la eliminación conserva la actividad');
  await evaluate(`document.querySelectorAll('[data-activity-action=remove]')[3].click();document.querySelector('#activity-delete-confirm').click();document.querySelector('#activity-delete-confirm').click()`);
  await wait(`!document.querySelector('#activity-delete-dialog').open`);
  check(await evaluate(`document.querySelectorAll('#activity-list>li').length===3&&document.querySelectorAll('#activity-removed-list>li').length===1`),'eliminación confirmada conserva el historial local');
  await selectDay('2031-05-21');check(await evaluate(`!document.querySelector('#agenda-empty').hidden`),'consultar otro día muestra su propia agenda');
  await create('Otro día','09:00','10:00');await selectDay(day);
  check(await evaluate(`document.querySelectorAll('#activity-list>li').length===3`),'volver de fecha conserva las actividades originales');
  await evaluate(`window.Date=window.AgendaNativeDate`);
  await command('Page.reload');await wait(ready);await selectDay(day);
  check(await evaluate(`document.querySelectorAll('#activity-list>li').length===3&&document.querySelectorAll('#activity-removed-list>li').length===1&&document.querySelector('#activity-list .goal-state').textContent==='Completada puntualmente'`),'recarga conserva agenda, ejecución y eliminaciones lógicas');

  const concurrency = await evaluate(`(async()=>{
    const {createActivityRepository}=await import('/assets/js/agenda-storage.js');const {createActivityService,overlapSignature,schedulesOverlap}=await import('/assets/js/agenda.js');
    const repository=createActivityRepository(),service=createActivityService(repository);
    const base={title:'Carrera entre pestañas',date:'2032-06-01',startTime:'09:00',endTime:'10:00'};
    const results=await Promise.allSettled([service.create(base),service.create({...base,title:'Segundo intento',startTime:'09:30',endTime:'10:30'})]);
    if(results.filter(r=>r.status==='fulfilled').length!==1||results.filter(r=>r.status==='rejected'&&r.reason.name==='OverlapError').length!==1)throw Error('Overlap race');
    let original=(await service.list(base.date))[0];
    const fields={title:'Versión nueva',date:original.schedule.date,startTime:original.schedule.startTime,endTime:original.schedule.endTime,goalId:original.goalId};
    const edits=await Promise.allSettled([service.edit(original,fields),service.edit(original,{...fields,title:'Versión obsoleta'})]);
    if(edits.filter(r=>r.status==='fulfilled').length!==1||edits.filter(r=>r.status==='rejected'&&r.reason.name==='ConflictError').length!==1)throw Error('Version race');
    const oldConsent=overlapSignature([original]);original=(await service.list(base.date))[0];
    await service.create(base,oldConsent).then(()=>{throw Error('Stale consent accepted')},error=>{if(error.name!=='OverlapError')throw error});
    const approved=await service.create(base,overlapSignature([original]));
    if((await service.list(base.date)).length!==2)throw Error('Approved overlap missing');
    await service.create({...base,startTime:'14:00',endTime:'15:00',goalId:'missing-goal'}).then(()=>{throw Error('Missing goal accepted')},error=>{if(!error.message.includes('objetivo'))throw error});
    repository.close();return true;
  })()`);
  check(concurrency,'IndexedDB real: solapamiento concurrente, versiones obsoletas, consentimiento caducado y vínculo validado');
  await evaluate(`document.querySelector('[data-activity-action=edit]').click()`);await wait(`document.querySelector('#activity-dialog').open&&!document.querySelector('#activity-save').disabled`);
  await evaluate(`(async()=>{const {createActivityRepository}=await import('/assets/js/agenda-storage.js');const {createActivityService}=await import('/assets/js/agenda.js');const service=createActivityService(createActivityRepository());const current=(await service.list('2031-05-20'))[0];await service.edit(current,{title:'Edición desde otra pestaña',date:current.schedule.date,startTime:current.schedule.startTime,endTime:current.schedule.endTime,goalId:current.goalId})})()`);
  await evaluate(`document.querySelector('#activity-title').value='No debe sobrescribir';document.querySelector('#activity-form').requestSubmit()`);
  await wait(`document.querySelector('#activity-form-error').textContent.includes('otra pestaña')`);
  check(await evaluate(`document.querySelector('#activity-dialog').open&&!document.querySelector('#activity-form-cancel').disabled`),'conflicto de agenda no sobrescribe y permite cancelar');
  await evaluate(`document.querySelector('#activity-form-cancel').click();document.querySelector('#agenda-retry').click()`);await wait(ready);
  check(await evaluate(`document.querySelector('#activity-list .goal-title').textContent==='Edición desde otra pestaña'`),'recargar recupera la actividad actualizada');

  await evaluate(`window.originalActivityPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const result=originalActivityPut.apply(this,args);if(this.name==='activities')this.transaction.abort();return result};document.querySelector('#agenda-create').click()`);
  await form('No debe guardarse','18:00','19:00');await evaluate(`document.querySelector('#activity-form').requestSubmit()`);
  await wait(`document.querySelector('#activity-form-error').textContent.includes('No se ha guardado')`);
  check(await evaluate(`document.querySelector('#activity-dialog').open&&document.querySelectorAll('#activity-list>li').length===3`),'aborto de IndexedDB no presenta una actividad fallida como guardada');
  await evaluate(`IDBObjectStore.prototype.put=window.originalActivityPut;document.querySelector('#activity-form-cancel').click()`);
  const after = await evaluate(`(async()=>{const {createGoalRepository}=await import('/assets/js/storage.js');const {createProfileRepository}=await import('/assets/js/profile-storage.js');return JSON.stringify({goals:await createGoalRepository().listAll(),profile:await createProfileRepository().load()})})()`);
  check(before===after,'agenda no modifica objetivos, progreso ni respuestas del perfil');
  for(const width of [320,375,390,430,768]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
    await evaluate(`document.querySelector('#agenda-create').click()`);await wait(`document.querySelector('#activity-dialog').open&&!document.querySelector('#activity-save').disabled`);
    check(await evaluate(`(()=>{const d=document.querySelector('#activity-dialog'),r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&d.scrollWidth<=d.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth})()`),`agenda y formulario sin desbordamiento a ${width}px`);
    if(width===320) {
      check(await evaluate(`document.activeElement.id==='activity-title'`),'foco inicial en el título de la actividad');
      await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      check(await evaluate(`document.activeElement.id==='activity-date'`),'teclado: Tab recorre los campos de agenda');
      await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      check(await evaluate(`!document.querySelector('#activity-dialog').open`),'teclado: Escape cierra sin guardar');
    } else await evaluate(`document.querySelector('#activity-form-cancel').click()`);
  }
  await evaluate(`document.querySelector('#agenda-today').click()`);await wait(ready);
}
