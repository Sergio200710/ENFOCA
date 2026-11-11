import { createPulseModel, curveSegments, intensity, shiftDay } from "./pulse.js";

const SVG = "http://www.w3.org/2000/svg";
const fullDate = new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "UTC" });
const shortDate = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });
const asDate = (day) => new Date(`${day}T12:00:00Z`);
const format = (day) => fullDate.format(asDate(day));
const percent = (value) => value === null ? "—" : `${value} %`;
const formatChange = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1, signDisplay: "exceptZero" });

function svg(tag, attributes = {}, text) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function description(day) {
  const result = !day.planned ? "Sin actividades registradas. Sin porcentaje de cumplimiento."
    : !day.required ? `${day.cancelled} actividades canceladas. Sin actividades exigibles ni porcentaje.`
    : `${day.percentage} % de cumplimiento. ${day.completed} completadas de ${day.required} exigibles. ${day.completedOnTime} puntuales y ${day.completedLate} con retraso.`;
  return `${format(day.date)}. ${result}`;
}

export function mountPulse() {
  const get = (id) => document.getElementById(id);
  let model;
  let anchor;
  let length = 7;
  let mapEnd;
  let curveDate;
  let mapDate;
  let busy = false;
  let restoreFocus = null;
  let period;

  function selectDate(kind, day, focus = false) {
    const parent = get(kind === "curve" ? "pulse-curve" : "pulse-map");
    if (kind === "curve") curveDate = day.date;
    else mapDate = day.date;
    for (const point of parent.querySelectorAll("[data-date]")) {
      const selected = point.dataset.date === day.date;
      point.setAttribute("aria-pressed", String(selected));
      point.setAttribute("tabindex", selected ? "0" : "-1");
      if (selected && focus) {
        point.focus({ preventScroll: true });
        point.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      }
    }
    get(`pulse-${kind}-detail`).textContent = description(day);
  }

  function keyboard(event, days, index, kind) {
    let step = 1;
    if (kind === "map") step = getComputedStyle(get("pulse-map")).gridTemplateColumns.split(" ").length;
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -step, ArrowDown: step };
    let next;
    if (Object.hasOwn(offsets, event.key)) next = Math.max(0, Math.min(days.length - 1, index + offsets[event.key]));
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = days.length - 1;
    if (next !== undefined) { event.preventDefault(); selectDate(kind, days[next], true); }
    if (event.key === " " || event.key === "Enter") { event.preventDefault(); selectDate(kind, days[index], true); }
  }

  function renderCurve() {
    const chart = get("pulse-curve");
    const days = period.days;
    const width = length === 30 ? 960 : Math.max(272, get("pulse-curve-scroll").clientWidth || 560);
    const height = 220;
    const x = (index) => 40 + index * (width - 66) / (days.length - 1 || 1);
    const y = (value) => 170 - value * 1.4;
    chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
    chart.style.width = `${width}px`;
    chart.classList.toggle("is-month", length === 30);
    get("pulse-curve-help").textContent = `${length === 30 ? "Desliza para recorrer las 30 fechas. " : ""}Selecciona una fecha o usa las flechas, Inicio y Fin. Los huecos no representan un 0 %.`;
    chart.replaceChildren();
    for (const value of [0, 50, 100]) {
      chart.append(svg("line", { x1: 40, x2: width - 26, y1: y(value), y2: y(value), class: "pulse-grid-line", "aria-hidden": "true" }));
      chart.append(svg("text", { x: 28, y: y(value) + 4, "text-anchor": "end", class: "pulse-axis", "aria-hidden": "true" }, value));
    }
    for (const segment of curveSegments(days)) {
      if (segment.length < 2) continue;
      let path = `M ${x(segment[0].index)} ${y(segment[0].percentage)}`;
      for (let i = 1; i < segment.length; i++) {
        const before = segment[i - 1], after = segment[i];
        const dx = (x(after.index) - x(before.index)) / 3;
        path += ` C ${x(before.index) + dx} ${y(before.percentage)}, ${x(after.index) - dx} ${y(after.percentage)}, ${x(after.index)} ${y(after.percentage)}`;
      }
      chart.append(svg("path", { d: path, class: "pulse-line", "aria-hidden": "true" }));
    }
    days.forEach((day, index) => {
      const point = svg("g", { role: "button", tabindex: -1, "data-date": day.date, "data-value": day.percentage ?? "", "data-kind": intensity(day), "aria-label": description(day), class: "pulse-point" });
      point.append(svg("rect", { x: x(index) - 14, y: y(day.percentage ?? 0) - 14, width: 28, height: 28, fill: "transparent" }));
      point.append(svg("circle", { cx: x(index), cy: y(day.percentage ?? 0), r: day.percentage === null ? 4 : 5 }));
      point.addEventListener("click", () => { if (!busy) selectDate("curve", day); });
      point.addEventListener("keydown", (event) => { if (!busy) keyboard(event, days, index, "curve"); });
      chart.append(point);
      if (length === 7 || index % 5 === 0 || index === days.length - 1) chart.append(svg("text", { x: x(index), y: 204, "text-anchor": "middle", class: "pulse-axis", "aria-hidden": "true" }, shortDate.format(asDate(day.date))));
    });
    const rows = days.map((day) => {
      const row = document.createElement("tr");
      const cells = [format(day.date), !day.planned ? "Sin actividades" : !day.required ? "Sin exigibles" : percent(day.percentage), String(day.completed), String(day.required)];
      cells.forEach((text, index) => {
        const cell = document.createElement(index === 0 ? "th" : "td");
        if (!index) cell.scope = "row";
        cell.textContent = text; row.append(cell);
      });
      return row;
    });
    get("pulse-table-body").replaceChildren(...rows);
    const selected = days.find(day => day.date === curveDate) || days.at(-1);
    selectDate("curve", selected);
  }

  function renderMap() {
    const days = model.range(shiftDay(mapEnd, -34), mapEnd);
    get("pulse-map-label").textContent = `${format(days[0].date)} – ${format(mapEnd)} · 35 fechas, en orden cronológico`;
    const buttons = days.map((day, index) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "pulse-cell";
      button.dataset.date = day.date; button.dataset.kind = intensity(day);
      button.textContent = String(Number(day.date.slice(-2)));
      button.setAttribute("aria-label", description(day));
      button.addEventListener("click", () => selectDate("map", day));
      button.addEventListener("keydown", event => keyboard(event, days, index, "map"));
      return button;
    });
    get("pulse-map").replaceChildren(...buttons);
    selectDate("map", days.find(day => day.date === mapDate) || days.at(-1));
    setBusy(busy);
  }

  function paint() {
    period = model.period(anchor, length);
    get("pulse-period-label").textContent = `${format(period.start)} – ${format(period.end)}`;
    for (const button of document.querySelectorAll("[data-pulse-period]")) button.setAttribute("aria-pressed", String(Number(button.dataset.pulsePeriod) === length));
    const { current, change } = period;
    get("pulse-percentage").textContent = percent(current.percentage);
    get("pulse-completed").textContent = String(current.completed);
    get("pulse-punctuality").textContent = percent(current.punctuality);
    get("pulse-ratio").textContent = `${current.completed} completadas de ${current.required} exigibles · ${current.completedOnTime} puntuales de ${current.completed} completadas · ${current.recordedDays} días con registros.`;
    get("pulse-change").textContent = change === null
      ? "Sin comparación suficiente: se necesitan al menos 3 días con exigibles en cada periodo."
      : `${formatChange.format(change)} puntos porcentuales frente a los ${length} días anteriores. Comparación de los registros disponibles; el periodo puede estar en curso.`;
    renderCurve(); renderMap();
    const calendar = model.calendar(anchor);
    get("pulse-month-title").textContent = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: "UTC" }).format(asDate(anchor));
    get("pulse-year-title").textContent = `Año ${anchor.slice(0, 4)}`;
    for (const name of ["month", "year"]) {
      get(`pulse-${name}-value`).textContent = percent(calendar[name].percentage);
      get(`pulse-${name}-ratio`).textContent = `${calendar[name].completed} completadas de ${calendar[name].required} exigibles · hasta el ${format(anchor)}`;
    }
    get("pulse-body").hidden = false; get("pulse-error").hidden = true;
  }

  function setBusy(value) {
    if (value && !busy) {
      const active = document.activeElement;
      restoreFocus = active?.closest("#pulse-map") ? { kind: "map", date: active.dataset.date }
        : active?.closest("#pulse-curve") ? { kind: "curve", date: active.dataset.date }
        : active?.closest("#pulse") ? { element: active } : null;
    }
    busy = value;
    for (const button of get("pulse").querySelectorAll("button")) button.disabled = value;
    get("pulse-map-next").disabled = value || mapEnd >= anchor;
    get("pulse-curve").setAttribute("aria-disabled", String(value));
    if (!value && restoreFocus) {
      if (document.activeElement === document.body && !get("resumen").hidden && !document.querySelector("dialog[open]")) {
        if (restoreFocus.kind && !get("pulse-body").hidden) selectDate(restoreFocus.kind, model.day(restoreFocus.date), true);
        else if (restoreFocus.element?.isConnected) restoreFocus.element.focus({ preventScroll: true });
      }
      restoreFocus = null;
    }
  }

  function revealCurveSelection() {
    const scroll = get("pulse-curve-scroll");
    const selected = get("pulse-curve").querySelector('[aria-pressed="true"] circle');
    if (selected) scroll.scrollLeft = Math.max(0, Number(selected.getAttribute("cx")) - scroll.clientWidth + 28);
  }
  for (const button of document.querySelectorAll("[data-pulse-period]")) button.addEventListener("click", () => {
    if (busy || !model) return;
    length = Number(button.dataset.pulsePeriod); safePaint();
    revealCurveSelection();
  });
  for (const [id, offset] of [["pulse-map-previous", -35], ["pulse-map-next", 35]]) get(id).addEventListener("click", () => {
    if (busy || !model) return;
    try { mapEnd = offset > 0 ? [shiftDay(mapEnd, offset), anchor].sort()[0] : shiftDay(mapEnd, offset); renderMap(); }
    catch { showError(); }
  });
  function showError() {
    get("pulse-body").hidden = true;
    get("pulse-error").textContent = "No se ha podido representar este periodo. Prueba otra fecha o actualiza el resumen. No se han modificado tus datos.";
    get("pulse-error").hidden = false;
  }
  function safePaint() { try { paint(); } catch { showError(); } }
  let lastWidth = 0;
  const observer = new ResizeObserver(([entry]) => {
    const width = entry.contentRect.width;
    if (!model || !width || width === lastWidth) return;
    lastWidth = width;
    const focused = document.activeElement?.closest("#pulse-curve");
    try {
      renderCurve();
      revealCurveSelection();
      if (focused) selectDate("curve", model.day(curveDate), true);
    } catch { showError(); }
  });
  observer.observe(get("pulse-curve-scroll"));
  return {
    setBusy,
    render(activities, date) {
      const focused = document.activeElement;
      const selectedKind = focused?.closest("#pulse-curve") ? "curve" : focused?.closest("#pulse-map") ? "map" : null;
      if (date !== anchor) { mapEnd = date; curveDate = date; mapDate = date; }
      anchor = date; model = createPulseModel(activities);
      safePaint();
      // Una actualización entre pestañas no pierde el foco del punto elegido.
      if (selectedKind && !get("pulse-body").hidden) selectDate(selectedKind, model.day(selectedKind === "curve" ? curveDate : mapDate), true);
    },
  };
}
