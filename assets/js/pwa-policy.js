export function needsIphoneInstallHelp({ userAgent, standalone = false }) {
  return !standalone && /iPhone/i.test(userAgent) && /Safari/i.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|DuckDuckGo/i.test(userAgent);
}

export function mayReloadForUpdate(document) {
  return !document.querySelector("dialog[open], main [aria-busy='true'], dialog[aria-busy='true']");
}
