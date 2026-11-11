export async function runSummaryBrowserTests({ command, evaluate, wait, check }) {
  const ready = `document.querySelector('#resumen').getAttribute('aria-busy')==='false'&&!document.querySelector('#summary-content').hidden`;
  const today = await evaluate(`(async()=> (await import('/assets/js/goals.js')).localDate())()`);
  async function refresh() {
    await evaluate(`window.dispatchEvent(new Event('enfoca:activities-changed'))`);
    await wait(ready);
  }
  async function select(date) {
    await evaluate(`document.querySelector('#summary-date').value=${JSON.stringify(date)};document.querySelector('#summary-date').dispatchEvent(new Event('change'))`);
    await wait(ready);
  }
  const baseline = await evaluate(`(async()=>{const {createGoalRepository}=await import('/assets/js/storage.js');const {createProfileRepository}=await import('/assets/js/profile-storage.js');return JSON.stringify({goals:await createGoalRepository().listAll(),profile:await createProfileRepository().load()})})()`);
  await wait(ready);await select(today);
  check(await evaluate(`document.querySelector('#summary-planned').textContent==='0'&&document.querySelector('#summary-percentage').textContent==='—'&&document.querySelector('#summary-celebration').hidden`),'resumen de día vacío sin porcentaje ni felicitación');
  await evaluate(`(async()=>{
    const {createActivityRepository}=await import('/assets/js/agenda-storage.js');const {createActivityService}=await import('/assets/js/agenda.js');
    window.summaryFixtureDate=${JSON.stringify(today)};window.summaryFixtureTime=summaryFixtureDate+'T08:00:00';window.summaryFixtureRepository=createActivityRepository();window.summaryFixtureService=createActivityService(summaryFixtureRepository,{now:()=>new Date(summaryFixtureTime)});
    window.summaryA=await summaryFixtureService.create({title:'Fixture A',date:summaryFixtureDate,startTime:'09:00',endTime:'10:00'});
    window.summaryB=await summaryFixtureService.create({title:'Fixture B',date:summaryFixtureDate,startTime:'11:00',endTime:'12:00'});
  })()`);
  await refresh();
  check(await evaluate(`document.querySelector('#summary-planned').textContent==='2'&&document.querySelector('#summary-pending').textContent==='2'&&document.querySelector('#summary-motivation').dataset.kind==='pending'`),'pendientes calculadas desde IndexedDB');
  await evaluate(`(async()=>{summaryFixtureTime=summaryFixtureDate+'T09:00:00';window.summaryA=await summaryFixtureService.transition(summaryA,'start')})()`);await refresh();
  check(await evaluate(`document.querySelector('#summary-motivation').dataset.kind==='in-progress'`),'mensaje de actividad en curso basado en su inicio registrado');
  await evaluate(`(async()=>{summaryFixtureTime=summaryFixtureDate+'T10:00:00';window.summaryA=await summaryFixtureService.transition(summaryA,'finish')})()`);await refresh();
  check(await evaluate(`document.querySelector('#summary-completed').textContent==='1'&&document.querySelector('#summary-percentage').textContent==='50%'&&document.querySelector('#summary-on-time').textContent==='1'`),'día parcial con recuentos y porcentaje reales');
  await evaluate(`(async()=>{window.summaryB=await summaryFixtureService.transition(summaryB,'skip');window.summaryC=await summaryFixtureService.create({title:'Cancelada',date:summaryFixtureDate,startTime:'15:00',endTime:'16:00'});window.summaryC=await summaryFixtureService.transition(summaryC,'cancel')})()`);await refresh();
  check(await evaluate(`document.querySelector('#summary-skipped').textContent==='1'&&document.querySelector('#summary-cancelled').textContent==='1'&&document.querySelector('#summary-percentage').textContent==='50%'&&document.querySelector('#summary-motivation').textContent.includes('omitidas')`),'omitidas en el denominador y canceladas fuera del porcentaje');
  await evaluate(`(async()=>{window.summaryB=await summaryFixtureService.remove(summaryB)})()`);await refresh();
  check(await evaluate(`document.querySelector('#summary-percentage').textContent==='100%'&&document.querySelector('#summary-celebration').open&&document.querySelector('#summary-celebration-title').textContent==='Un día completo y puntual'`),'felicitación automática por cumplimiento y puntualidad totales');
  await evaluate(`(async()=>{window.summaryE=await summaryFixtureService.create({title:'Nuevo paso',date:summaryFixtureDate,startTime:'11:00',endTime:'12:00'})})()`);await refresh();
  check(await evaluate(`document.querySelector('#summary-percentage').textContent==='50%'&&document.querySelector('#summary-celebration').hidden`),'añadir una actividad invalida la felicitación anterior');
  await evaluate(`(async()=>{summaryFixtureTime=summaryFixtureDate+'T11:01:00';window.summaryE=await summaryFixtureService.transition(summaryE,'start');summaryFixtureTime=summaryFixtureDate+'T11:30:00';window.summaryE=await summaryFixtureService.transition(summaryE,'finish')})()`);await refresh();
  check(await evaluate(`document.querySelector('#summary-completed').textContent==='2'&&document.querySelector('#summary-late').textContent==='1'&&document.querySelector('#summary-percentage').textContent==='100%'&&!document.querySelector('#summary-celebration').hidden&&!document.querySelector('#summary-celebration').open`),'cumplimiento total con retraso no repite la apertura automática');
  await evaluate(`document.querySelector('#summary-celebration summary').click()`);
  check(await evaluate(`document.querySelector('#summary-celebration').open&&document.querySelector('#summary-celebration-title').textContent==='Has completado lo que te propusiste'`),'felicitación consultable diferencia cumplimiento de puntualidad');
  await command('Page.reload');await wait(ready);
  check(await evaluate(`document.querySelector('#summary-percentage').textContent==='100%'&&!document.querySelector('#summary-celebration').open`),'recargar conserva las cifras y no vuelve a abrir la felicitación');
  const once = await evaluate(`(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('enfoca');r.onsuccess=()=>resolve(r.result)});const result=await new Promise(resolve=>{const r=db.transaction('dailyMessages').objectStore('dailyMessages').getAll();r.onsuccess=()=>resolve(r.result.filter(item=>item.date===${JSON.stringify(today)}))});db.close();return result.length===1})()`);
  check(once,'solo un marcador persistido por fecha');
  const advanced = await evaluate(`(async()=>{
    const {createActivityRepository}=await import('/assets/js/agenda-storage.js');const {createActivityService}=await import('/assets/js/agenda.js');const {createSummaryRepository}=await import('/assets/js/summary-storage.js');
    const repository=createActivityRepository();let instant;const service=createActivityService(repository,{now:()=>new Date(instant)});
    const today=${JSON.stringify(today)};const offset=(n)=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
    for(const n of [-3,-2,-1,-10]){const date=offset(n);instant=date+'T08:00:00';let a=await service.create({title:'Historial de prueba',date,startTime:'09:00',endTime:'10:00'});if(n===-10){await service.transition(a,'cancel')}else{instant=date+'T09:00:00';a=await service.transition(a,'start');instant=date+'T10:00:00';await service.transition(a,'finish')}}
    const first=createSummaryRepository(),second=createSummaryRepository();
    const claims=await Promise.all([first.snapshot(offset(-1),{claim:true}),second.snapshot(offset(-1),{claim:true})]);
    if(claims.filter(item=>item.claimed).length!==1)throw Error('Duplicate claim');
    const stored=(await repository.list(today)).find(item=>item.status==='completed_late');
    window.summaryReopened=await repository.update(stored.id,stored.version,current=>({...current,status:'scheduled',actualStartAt:null,actualEndAt:null,version:current.version+1}));
    window.summaryBeforeReopen=stored;window.summaryRepository=repository;
    first.close();second.close();return {yesterday:offset(-1),cancelled:offset(-10),empty:offset(-11)};
  })()`);
  console.log('PASS: transacciones concurrentes adjudican una sola felicitación');
  await refresh();
  check(await evaluate(`document.querySelector('#summary-pending').textContent==='1'&&document.querySelector('#summary-percentage').textContent==='50%'&&document.querySelector('#summary-celebration').hidden`),'reapertura simulada de un registro recalcula el resumen sin mensaje obsoleto');
  await evaluate(`(async()=>{await summaryRepository.update(summaryReopened.id,summaryReopened.version,current=>({...summaryBeforeReopen,version:current.version+1}));summaryRepository.close()})()`);await refresh();
  await select(advanced.yesterday);
  const historyCheck = await evaluate(`({selected:document.querySelector('#summary-date').value,streak:document.querySelector('#summary-motivation').textContent.includes('3 días naturales'),spanish:/[a-záéíóúñ]+ de [0-9]{4}/.test(document.querySelector('#summary-date-label').textContent),options:document.querySelector('#summary-history').options.length})`);
  check(historyCheck.selected===advanced.yesterday,'historial selecciona el día solicitado');
  check(historyCheck.streak,'historial calcula la racha de tres días con datos suficientes');
  check(historyCheck.spanish,'historial muestra la fecha en español');
  check(historyCheck.options>=4,'historial lista únicamente días anteriores con registros');
  await select(advanced.cancelled);
  check(await evaluate(`document.querySelector('#summary-cancelled').textContent==='1'&&document.querySelector('#summary-percentage').textContent==='—'&&document.querySelector('#summary-celebration').hidden`),'día con todas las actividades canceladas no recibe felicitación');
  await select(advanced.empty);
  check(await evaluate(`document.querySelector('#summary-planned').textContent==='0'&&!document.querySelector('#summary-empty').hidden`),'fecha histórica sin datos se muestra vacía');
  await select(today);
  await evaluate(`window.summaryOriginalTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(Array.isArray(args[0])&&args[0].includes('dailyMessages')&&args[1]==='readwrite')throw new DOMException('forced','QuotaExceededError');return summaryOriginalTransaction.apply(this,args)};document.querySelector('#summary-retry').click()`);
  await wait(ready);
  check(await evaluate(`!document.querySelector('#summary-save-warning').hidden&&document.querySelector('#summary-percentage').textContent==='100%'`),'fallo del marcador mantiene disponible el resumen derivado sin anunciar un guardado');
  await evaluate(`IDBDatabase.prototype.transaction=window.summaryOriginalTransaction;window.summaryOriginalGetAll=IDBObjectStore.prototype.getAll;IDBObjectStore.prototype.getAll=function(...args){if(this.name==='activities')throw new DOMException('denied','SecurityError');return summaryOriginalGetAll.apply(this,args)};document.querySelector('#summary-retry').click()`);
  await wait(`!document.querySelector('#summary-error').hidden&&document.querySelector('#resumen').getAttribute('aria-busy')==='false'`);
  check(await evaluate(`document.querySelector('#summary-content').hidden`),'lectura fallida no se confunde con un resumen vacío');
  await evaluate(`IDBObjectStore.prototype.getAll=window.summaryOriginalGetAll;document.querySelector('#summary-retry').click()`);await wait(ready);
  const after = await evaluate(`(async()=>{const {createGoalRepository}=await import('/assets/js/storage.js');const {createProfileRepository}=await import('/assets/js/profile-storage.js');return JSON.stringify({goals:await createGoalRepository().listAll(),profile:await createProfileRepository().load()})})()`);
  check(after===baseline,'resumen y motivación no modifican objetivos ni perfil');
  for(const width of [320,375,390,430,768]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
    check(await evaluate(`document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.summary-grid').scrollWidth<=document.querySelector('.summary-grid').clientWidth`),`resumen sin desbordamiento a ${width}px`);
  }
  await evaluate(`document.querySelector('#summary-celebration').open=false;document.querySelector('#summary-celebration summary').focus()`);
  check(await evaluate(`document.activeElement===document.querySelector('#summary-celebration summary')`),'teclado: la felicitación consultable recibe el foco');
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:String.fromCharCode(13),unmodifiedText:String.fromCharCode(13)});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  check(await evaluate(`document.querySelector('#summary-celebration').open`),'teclado: Enter permite consultar la felicitación');
}
