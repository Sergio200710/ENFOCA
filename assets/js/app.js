"use strict";

// El estado inicial permanece vacío hasta incorporar la gestión de objetivos.
const greetingElement = document.getElementById("greeting");
const dateElement = document.getElementById("current-date");
const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function updateWelcome() {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour >= 6 && hour < 12
    ? "Buenos días."
    : hour >= 12 && hour < 21
      ? "Buenas tardes."
      : "Buenas noches.";

  greetingElement.textContent = greeting;
  dateElement.textContent = dateFormatter.format(now);
  // Fecha local: evita que la conversión a UTC cambie el día mostrado.
  dateElement.dateTime = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

updateWelcome();
window.setInterval(updateWelcome, 60_000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) updateWelcome();
});
