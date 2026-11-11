import { QUESTIONS, emptyAnswers, createProfileService } from "./profile.js";
import { createProfileRepository } from "./profile-storage.js";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Controles nativos: selección múltiple, radios y dos selectores de hora 24 h.
function questionField(question, answer, prefix, compact = false) {
  const group = element("fieldset", "question-group");
  group.dataset.question = question.key;
  group.append(element("legend", compact ? "sr-only" : "", question.title));
  if (question.hint) {
    const hint = element("p", "question-hint", question.hint);
    hint.id = `${prefix}-${question.key}-hint`;
    group.append(hint);
    group.setAttribute("aria-describedby", hint.id);
  }
  if (question.type === "time") {
    const parts = answer?.split(":") || ["", ""];
    const time = element("div", "time-selects");
    for (const [part, limit, label] of [[0, 24, "Hora (00–23)"], [1, 60, "Minutos (00–59)"]]) {
      const wrapper = element("div");
      const select = element("select");
      select.id = `${prefix}-${question.key}-${part === 0 ? "hour" : "minute"}`;
      select.name = select.id;
      const caption = element("label", "", label);
      caption.htmlFor = select.id;
      const placeholder = element("option", "", "Sin elegir");
      placeholder.value = "";
      select.append(placeholder);
      for (let number = 0; number < limit; number++) {
        const value = String(number).padStart(2, "0");
        const option = element("option", "", value);
        option.value = value;
        select.append(option);
      }
      select.value = parts[part];
      wrapper.append(caption, select);
      time.append(wrapper);
    }
    group.append(time);
  } else {
    const choices = element("div", "answer-choices");
    for (const [code, label] of question.options) {
      const wrapper = element("label", "answer-choice");
      const input = element("input");
      input.type = question.type === "multiple" ? "checkbox" : "radio";
      input.name = `${prefix}-${question.key}`;
      input.value = code;
      input.id = `${prefix}-${question.key}-${code}`;
      input.checked = question.type === "multiple" ? answer.includes(code) : answer === code;
      wrapper.htmlFor = input.id;
      wrapper.append(input, element("span", "", label));
      choices.append(wrapper);
    }
    group.append(choices);
  }
  const clear = element("button", "text-button clear-answer", "Borrar respuesta");
  clear.type = "button";
  clear.setAttribute("aria-label", `Borrar respuesta: ${question.title}`);
  clear.addEventListener("click", () => {
    for (const input of group.querySelectorAll("input")) input.checked = false;
    for (const select of group.querySelectorAll("select")) select.value = "";
  });
  group.append(clear);
  return group;
}

function readAnswer(group, question) {
  if (question.type === "multiple") return [...group.querySelectorAll("input:checked")].map((input) => input.value);
  if (question.type === "single") return group.querySelector("input:checked")?.value ?? null;
  const [hour, minute] = [...group.querySelectorAll("select")].map((select) => select.value);
  if (!hour && !minute) return null;
  if (!hour || !minute) throw new Error("Elige hora y minutos, o pulsa Borrar respuesta para dejar esta pregunta sin responder.");
  return `${hour}:${minute}`;
}

export function mountProfile() {
  const get = (id) => document.getElementById(id);
  const wizard = get("onboarding-dialog");
  const preferences = get("preferences-dialog");
  const service = createProfileService(createProfileRepository());
  let profile = null;
  let draft = emptyAnswers();
  let step = 0;
  let busy = false;
  let loaded = false;
  let welcome = false;

  function setBusy(value) {
    busy = value;
    for (const dialog of [wizard, preferences]) {
      dialog.setAttribute("aria-busy", String(value));
      for (const control of dialog.querySelectorAll("button, input, select")) control.disabled = value;
    }
    get("open-preferences").disabled = value;
    get("preferences-save").disabled = value || !loaded;
    get("preferences-onboarding").disabled = value || !loaded;
    get("onboarding-back").hidden = step === 0;
    get("onboarding-next").textContent = value ? "Guardando…" : step === QUESTIONS.length - 1 ? "Finalizar" : "Siguiente";
  }
  function close(dialog) {
    dialog.close();
    get("open-preferences").focus();
  }
  function renderStep() {
    const question = QUESTIONS[step];
    welcome = false;
    wizard.setAttribute("aria-labelledby", "onboarding-title");
    get("onboarding-steps").hidden = false;
    get("onboarding-welcome").hidden = true;
    get("onboarding-title").textContent = question.title;
    get("onboarding-step-label").textContent = `Paso ${step + 1} de ${QUESTIONS.length}`;
    const progress = get("onboarding-progress");
    progress.setAttribute("aria-valuenow", String(step + 1));
    progress.firstElementChild.style.width = `${(step + 1) / QUESTIONS.length * 100}%`;
    get("onboarding-question").replaceChildren(questionField(question, draft[question.key], "onboarding", true));
    get("onboarding-error").textContent = "";
    get("onboarding-exit").hidden = true;
    setBusy(false);
    if (wizard.open) get("onboarding-title").focus();
  }
  function startWizard() {
    if (busy || !loaded) return;
    draft = structuredClone(profile?.answers ?? emptyAnswers());
    step = 0;
    preferences.close();
    renderStep();
    wizard.showModal();
    get("onboarding-title").focus();
  }
  function renderPreferences() {
    const answers = profile?.answers ?? emptyAnswers();
    get("preferences-fields").replaceChildren(...QUESTIONS.map((question) => questionField(question, answers[question.key], "profile")));
    get("preferences-status").textContent = profile?.onboardingStatus === "completed" ? "Tus respuestas guardadas. Todas se pueden modificar o borrar." : profile?.onboardingStatus === "skipped" ? "Omitiste la bienvenida. Puedes responder aquí o retomarla paso a paso." : "Aún no has completado la bienvenida. Puedes responder aquí o hacerlo paso a paso.";
    get("preferences-error").textContent = "";
    get("preferences-retry").hidden = true;
  }
  async function load(initial = false) {
    if (busy) return;
    if (!initial && !preferences.open) preferences.showModal();
    get("preferences-status").textContent = "Cargando preferencias…";
    get("preferences-error").textContent = "";
    get("preferences-retry").hidden = true;
    setBusy(true);
    let openWizard = false;
    try {
      profile = await service.load();
      loaded = true;
      renderPreferences();
      openWizard = initial && (!profile || profile.onboardingStatus === "pending");
    } catch (error) {
      loaded = false;
      get("preferences-status").textContent = "No se han podido leer tus preferencias. Esto no significa que estén vacías.";
      get("preferences-error").textContent = error.message;
      get("preferences-retry").hidden = false;
      get("preferences-fields").replaceChildren();
      if (!preferences.open) preferences.showModal();
    } finally {
      setBusy(false);
      if (openWizard) startWizard();
      else if (preferences.open) get("preferences-title").focus();
    }
  }
  function captureCurrent() {
    const question = QUESTIONS[step];
    draft[question.key] = readAnswer(get("onboarding-question"), question);
  }
  async function finish(status) {
    if (busy) return;
    if (!welcome) {
      try { captureCurrent(); }
      catch (error) {
        if (status === "skipped") draft[QUESTIONS[step].key] = QUESTIONS[step].type === "multiple" ? [] : null;
        else { get("onboarding-error").textContent = error.message; return; }
      }
    }
    setBusy(true);
    get("onboarding-error").textContent = "";
    try {
      profile = await service.save(profile, draft, status);
      if (status === "skipped") close(wizard);
      else {
        welcome = true;
        get("onboarding-steps").hidden = true;
        get("onboarding-welcome").hidden = false;
        get("onboarding-title").textContent = "Bienvenido a ENFOCA";
        wizard.setAttribute("aria-labelledby", "onboarding-welcome-message");
      }
    } catch (error) {
      get("onboarding-error").textContent = `${error.message} No se ha guardado. Puedes reintentar o ir a Inicio sin guardar.`;
      get("onboarding-exit").hidden = false;
    } finally {
      setBusy(false);
      if (welcome) get("onboarding-enter").focus();
    }
  }
  async function savePreferences(event) {
    event.preventDefault();
    if (busy || !loaded) return;
    const answers = emptyAnswers();
    try {
      for (const question of QUESTIONS) answers[question.key] = readAnswer(get("preferences-fields").querySelector(`[data-question="${question.key}"]`), question);
    } catch (error) { get("preferences-error").textContent = error.message; return; }
    setBusy(true);
    get("preferences-error").textContent = "";
    get("preferences-status").textContent = "Guardando en este dispositivo…";
    try {
      profile = await service.save(profile, answers, "completed");
      get("preferences-status").textContent = "Cambios guardados en este dispositivo.";
      get("preferences-retry").hidden = true;
    } catch (error) {
      get("preferences-status").textContent = "Los cambios del formulario no se han guardado.";
      get("preferences-error").textContent = error.message;
      if (error.name === "ConflictError") get("preferences-retry").hidden = false;
    } finally { setBusy(false); }
  }

  get("open-preferences").addEventListener("click", () => void load());
  get("preferences-close").addEventListener("click", () => { if (!busy) close(preferences); });
  get("preferences-retry").addEventListener("click", () => void load());
  get("preferences-onboarding").addEventListener("click", startWizard);
  get("preferences-form").addEventListener("submit", savePreferences);
  get("onboarding-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy) return;
    try {
      captureCurrent();
      if (step < QUESTIONS.length - 1) { step++; renderStep(); }
      else void finish("completed");
    } catch (error) { get("onboarding-error").textContent = error.message; }
  });
  get("onboarding-back").addEventListener("click", () => {
    if (busy || step === 0) return;
    try { captureCurrent(); step--; renderStep(); }
    catch (error) { get("onboarding-error").textContent = error.message; }
  });
  get("onboarding-skip-question").addEventListener("click", () => {
    if (busy) return;
    draft[QUESTIONS[step].key] = QUESTIONS[step].type === "multiple" ? [] : null;
    if (step < QUESTIONS.length - 1) { step++; renderStep(); }
    else {
      get("onboarding-question").replaceChildren(questionField(QUESTIONS[step], draft[QUESTIONS[step].key], "onboarding", true));
      void finish("completed");
    }
  });
  get("onboarding-skip").addEventListener("click", () => void finish("skipped"));
  get("onboarding-exit").addEventListener("click", () => { if (!busy) close(wizard); });
  get("onboarding-enter").addEventListener("click", () => { if (!busy) close(wizard); });
  wizard.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!busy) { if (welcome) close(wizard); else void finish("skipped"); }
  });
  preferences.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
  void load(true);
}
