import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function runPulseBrowserTests({ command, evaluate, wait, check }) {
  await evaluate(`location.hash='resumen';document.querySelector('#summary-today').click()`);
  const ready = `!document.querySelector('#resumen').hidden && document.querySelector('#resumen').getAttribute('aria-busy') === 'false' && !document.querySelector('#summary-content').hidden && !document.querySelector('#pulse-body').hidden`;
  await wait(ready);
  const baseline = await evaluate(`(async()=>{const {createGoalRepository}=await import('/assets/js/storage.js');const {createProfileRepository}=await import('/assets/js/profile-storage.js');return JSON.stringify({goals:await createGoalRepository().listAll(),profile:await createProfileRepository().load()})})()`);
  const dates = await evaluate(`(async()=>{
    const {createActivityService}=await import('/assets/js/agenda.js');const {createActivityRepository}=await import('/assets/js/agenda-storage.js');const {shiftDay}=await import('/assets/js/pulse.js');const {localDate}=await import('/assets/js/goals.js');
    window.pulseRepository=createActivityRepository();let stamp;window.pulseService=createActivityService(pulseRepository,{now:()=>new Date(stamp)});window.pulseToday=localDate();
    window.pulseDates={full:shiftDay(pulseToday,-22),partial:shiftDay(pulseToday,-23),empty:shiftDay(pulseToday,-24),cancelled:shiftDay(pulseToday,-25),zero:shiftDay(pulseToday,-26)};
    for(const [kind,date] of Object.entries(pulseDates)){
      if(kind==='empty')continue;
      stamp=date+'T08:00:00';let a=await pulseService.create({title:'Pulse: '+kind,date,startTime:'18:00',endTime:'18:30'});
      if(kind==='cancelled'){await pulseService.transition(a,'cancel');continue}
      if(kind==='zero'){await pulseService.transition(a,'skip');continue}
      stamp=date+(kind==='partial'?'T18:01:00':'T18:00:00');a=await pulseService.transition(a,'start');stamp=date+'T18:20:00';await pulseService.transition(a,'finish');
      if(kind==='partial'){stamp=date+'T08:00:00';window.pulsePending=await pulseService.create({title:'Pendiente Pulse',date,startTime:'19:00',endTime:'19:30'})}
    }
    return pulseDates;
  })()`);
  await evaluate(`window.dispatchEvent(new Event('enfoca:activities-changed'))`); await wait(ready);
  await evaluate(`document.querySelector('[data-pulse-period="30"]').click()`);
  await evaluate(`document.querySelector('[data-pulse-period="30"]').focus()`);
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  check(await evaluate(`document.activeElement.closest('#pulse-curve')!==null`), "Pulse: Tab permite entrar en el gráfico sin ratón");
  check(await evaluate(`document.querySelectorAll('#pulse-curve [data-date]').length===30&&document.querySelectorAll('#pulse-table-body tr').length===30`), "Pulse: curva de 30 fechas y tabla accesible con todos los días");
  const data = await evaluate(`Object.fromEntries([...document.querySelectorAll('#pulse-curve [data-date]')].map(node=>[node.dataset.date,{value:node.dataset.value,kind:node.dataset.kind,label:node.getAttribute('aria-label')}]))`);
  check(data[dates.full].value==='100'&&data[dates.partial].value==='50', "Pulse: días completos y parciales desde IndexedDB");
  check(data[dates.empty].kind==='empty'&&data[dates.empty].value===''&&data[dates.cancelled].kind==='excluded'&&data[dates.zero].value==='0', "Pulse: sin actividades, canceladas y cero son estados distintos");
  check(await evaluate(`(()=>{const points=[...document.querySelectorAll('#pulse-curve [data-date]')];const paths=[...document.querySelectorAll('#pulse-curve .pulse-line')];return paths.every(path=>{const d=path.getAttribute('d');return !d.includes('NaN')&&!d.includes('undefined')})&&points.every(p=>p.getAttribute('aria-label').includes('de'))})()`), "Pulse: SVG finito y puntos con fechas y descripciones accesibles");
  await evaluate(`document.querySelector('#pulse-curve [data-date="${dates.partial}"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  check(await evaluate(`document.querySelector('#pulse-curve-detail').textContent.includes('50 %')&&document.querySelector('#pulse-curve-detail').textContent.includes('1 completadas de 2 exigibles')`), "Pulse: seleccionar punto muestra detalles reales");
  await evaluate(`document.querySelector('#pulse-curve [aria-pressed="true"]').focus()`);
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  check(await evaluate(`document.activeElement.dataset.date==='${dates.full}'&&document.querySelector('#pulse-curve-detail').textContent.includes('100 %')`), "Pulse: flechas seleccionan puntos de la curva con teclado");
  for(const [kind,date] of Object.entries(dates)) {
    await evaluate(`document.querySelector('#pulse-map [data-date="${date}"]').click()`);
    check(await evaluate(`document.querySelector('#pulse-map [aria-pressed="true"]').dataset.date==='${date}' && document.querySelector('#pulse-map-detail').textContent.length>40`), `Pulse: detalle de celda ${kind}`);
  }
  await evaluate(`document.querySelector('#pulse-map [aria-pressed="true"]').focus()`);
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Home',code:'Home',windowsVirtualKeyCode:36});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Home',code:'Home',windowsVirtualKeyCode:36});
  check(await evaluate(`document.activeElement===document.querySelector('#pulse-map button')`), "Pulse: Inicio selecciona la primera fecha del mapa");
  const focusedDate = await evaluate(`document.activeElement.dataset.date`);
  await evaluate(`window.dispatchEvent(new Event('enfoca:activities-changed'))`); await wait(ready);
  check(await evaluate(`document.activeElement.dataset.date==='${focusedDate}'&&document.activeElement.closest('#pulse-map')!==null`), "Pulse: actualizar IndexedDB conserva el foco de la celda seleccionada");
  const mapEnd = await evaluate(`document.querySelector('#pulse-map button:last-child').dataset.date`);
  await evaluate(`document.querySelector('#pulse-map-previous').click()`);
  check(await evaluate(`document.querySelector('#pulse-map button:last-child').dataset.date<'${mapEnd}'&&!document.querySelector('#pulse-map-next').disabled`), "Pulse: consulta de 35 fechas anteriores");
  await evaluate(`document.querySelector('#pulse-map-next').click()`);
  check(await evaluate(`document.querySelector('#pulse-map button:last-child').dataset.date==='${mapEnd}'&&document.querySelector('#pulse-map-next').disabled`), "Pulse: volver al periodo actual limita la navegación futura");
  await evaluate(`(async()=>{window.pulsePending=await pulseService.transition(pulsePending,'cancel');window.dispatchEvent(new Event('enfoca:activities-changed'))})()`); await wait(ready);
  check(await evaluate(`document.querySelector('#pulse-curve [data-date="${dates.partial}"]').dataset.value==='100'`), "Pulse: cambios posteriores en IndexedDB recalculan el gráfico");
  await command('Page.reload'); await wait(ready);
  await evaluate(`document.querySelector('[data-pulse-period="30"]').click()`);
  check(await evaluate(`document.querySelector('#pulse-curve [data-date="${dates.partial}"]').dataset.value==='100'`), "Pulse: recargar conserva datos sin almacenar estadísticas duplicadas");
  await evaluate(`document.querySelector('#summary-date').value='${dates.zero}';document.querySelector('#summary-date').dispatchEvent(new Event('change'))`); await wait(ready);
  check(await evaluate(`document.querySelector('#pulse-curve [data-date]:last-of-type')!==null&&document.querySelector('#pulse-period-label').textContent.length>20&&document.querySelector('#pulse-percentage').textContent==='0 %'`), "Pulse: fecha histórica recalcula periodos y calendario");
  await evaluate(`document.querySelector('#summary-today').click()`); await wait(ready);
  await evaluate(`document.querySelector('[data-pulse-period="30"]').click()`);
  await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  check(await evaluate(`[...document.querySelectorAll('.pulse-line')].every(path=>getComputedStyle(path).animationName==='none')`), "Pulse: movimiento reducido elimina la animación");
  await command('Emulation.setEmulatedMedia',{features:[]});
  await evaluate(`document.querySelector('.pulse-table-details').open=true`);
  const accessibility = await command('Accessibility.getFullAXTree');
  check(accessibility.nodes.some(node=>node.role?.value==='button'&&node.name?.value.includes('completadas de'))&&accessibility.nodes.some(node=>node.role?.value==='table'), "Pulse: árbol de accesibilidad expone botones con métricas y tabla alternativa");
  await evaluate(`document.querySelector('.pulse-table-details').open=false`);
  const artifacts = join(tmpdir(),'enfoca-pulse-preview'); await mkdir(artifacts,{recursive:true});
  for (const width of [320,390,768,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:width===1440?1000:844,deviceScaleFactor:1,mobile:width<768});
    check(await evaluate(`document.documentElement.scrollWidth<=innerWidth && document.querySelector('#pulse-curve-scroll').scrollWidth>=document.querySelector('#pulse-curve-scroll').clientWidth`), `Pulse: curva desplazable sin desbordamiento a ${width}px`);
    check(await evaluate(`(()=>{const dates=[...document.querySelectorAll('#pulse-map button')].map(b=>b.dataset.date);return dates.every((date,i)=>!i||date>dates[i-1])})()`), `Pulse: orden cronológico del mapa a ${width}px`);
    if (width===390||width===1440) {
      await evaluate(`document.querySelector('[data-pulse-period="7"]').click();document.querySelector('#pulse').scrollIntoView({block:'start'})`);
      const week=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      await writeFile(join(artifacts,`pulse-7-${width}.png`),Buffer.from(week.data,'base64'));
      await evaluate(`document.querySelector('[data-pulse-period="30"]').click()`);
      await evaluate(`document.querySelector('#pulse').scrollIntoView({block:'start'})`);
      const capture=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      await writeFile(join(artifacts,`pulse-${width}.png`),Buffer.from(capture.data,'base64'));
      await evaluate(`document.querySelector('#pulse-map-title').scrollIntoView({block:'start'})`);
      const map=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      await writeFile(join(artifacts,`constancia-${width}.png`),Buffer.from(map.data,'base64'));
    }
  }
  const end = await evaluate(`(async()=>{const {createGoalRepository}=await import('/assets/js/storage.js');const {createProfileRepository}=await import('/assets/js/profile-storage.js');const db=await new Promise(resolve=>{const request=indexedDB.open('enfoca');request.onsuccess=()=>resolve(request.result)});const version=db.version;db.close();return {version,data:JSON.stringify({goals:await createGoalRepository().listAll(),profile:await createProfileRepository().load()})}})()`);
  check(end.version===4&&end.data===baseline, "Pulse: conserva IndexedDB v4, objetivos y perfil");
  console.log(`CAPTURAS PULSE: ${artifacts} (datos sintéticos en perfil aislado)`);
}
