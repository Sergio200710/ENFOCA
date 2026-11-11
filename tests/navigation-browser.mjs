export async function runNavigationBrowserTests({ command, evaluate, wait, check }) {
  const route = async (id) => {
    await evaluate(`document.querySelector('.bottom-nav a[href="#${id}"]').click()`);
    await wait(`!document.getElementById("${id}").hidden`);
  };
  for (const id of ["inicio", "objetivos", "agenda", "resumen"]) {
    await route(id);
    check(await evaluate(`document.querySelectorAll('[data-view]:not([hidden])').length === 1 && document.querySelector('.bottom-nav [aria-current="page"]').hash === "#${id}"`), `una sola vista y enlace activo: ${id}`);
  }
  await evaluate(`history.back()`);
  await wait(`!document.querySelector("#agenda").hidden`);
  check(await evaluate(`location.hash === "#agenda"`), "Atrás conserva el historial de navegación");
  await evaluate(`history.forward()`);
  await wait(`!document.querySelector("#resumen").hidden`);
  check(await evaluate(`location.hash === "#resumen"`), "Adelante restaura Progreso");
  await route("objetivos");
  await evaluate(`document.querySelector('[data-action="edit"]').click(); document.querySelector('#goal-title').value='Borrador sin guardar';location.hash='agenda'`);
  await wait(`!document.querySelector("#agenda").hidden`);
  check(await evaluate(`document.querySelector('#goal-dialog').open && document.querySelector('#goal-title').value === 'Borrador sin guardar'`), "cambiar la ruta conserva el formulario y su borrador");
  await evaluate(`document.querySelector('#cancel-goal').click()`);
  await route("inicio");
  check(await evaluate(`document.querySelector('#completed-count').textContent !== '—' && !document.querySelector('#home-activity-status').textContent.includes('Consultando')`), "Inicio consulta objetivos y agenda reales");
  const original = await evaluate(`(async()=>{const {createActivityRepository}=await import('/assets/js/agenda-storage.js');return JSON.stringify(await createActivityRepository().list(document.querySelector('#current-date').dateTime))})()`);
  await evaluate(`window.dispatchEvent(new Event('enfoca:activities-changed'))`);
  await route("agenda");
  await route("inicio");
  check(await evaluate(`(async()=>{const {createActivityRepository}=await import('/assets/js/agenda-storage.js');return JSON.stringify(await createActivityRepository().list(document.querySelector('#current-date').dateTime)) === ${JSON.stringify(original)}})()`), "consultar Inicio no altera estados ni horarios de actividades");
  for (const width of [320,375,390,430,768,1024,1440]) {
    await command("Emulation.setDeviceMetricsOverride", {width,height:900,deviceScaleFactor:1,mobile:width<768});
    for (const id of ["inicio","objetivos","agenda","resumen"]) {
      await route(id);
      check(await evaluate(`document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.bottom-nav a')].every(a=>{const r=a.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=0&&r.right<=innerWidth})`), `${id}: sin desbordamiento y navegación táctil a ${width}px`);
    }
    check(await evaluate(`(()=>{const r=document.querySelector('.bottom-nav').getBoundingClientRect();return ${width>=1024 ? 'r.height === innerHeight && r.width < 300' : 'Math.abs(r.bottom-innerHeight)<1 && Math.abs(r.width-document.documentElement.clientWidth)<1'}})()`), `navegación ${width>=1024 ? 'lateral' : 'inferior'} a ${width}px`);
  }
  await route("objetivos");
  await command("Input.dispatchKeyEvent", { type:"keyDown",key:"Tab",code:"Tab",windowsVirtualKeyCode:9 });
  await command("Input.dispatchKeyEvent", { type:"keyUp",key:"Tab",code:"Tab",windowsVirtualKeyCode:9 });
  check(await evaluate(`document.activeElement.closest('[data-view]')?.id === 'objetivos'`), "teclado: Tab entra en la vista activa");
}
