// Mantiene los nodos y los borradores: navegar solo cambia su visibilidad.
export function mountNavigation() {
  const views = [...document.querySelectorAll("[data-view]")];
  const links = [...document.querySelectorAll(".bottom-nav a")];
  let current;
  const positions = new Map();
  function render(initial = false) {
    const id = location.hash.slice(1) || "inicio";
    if (!views.some(view => view.id === id)) return;
    if (current === id) return;
    if (current) positions.set(current, window.scrollY);
    for (const view of views) view.hidden = view.id !== id;
    for (const link of links) {
      const active = link.hash === `#${id}`;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    current = id;
    document.title = `${links.find(link => link.hash === `#${id}`).textContent.trim()} · ENFOCA`;
    if (!initial && !document.querySelector("dialog[open]")) {
      document.getElementById(id).querySelector("h1")?.focus({ preventScroll: true });
      window.scrollTo(0, positions.get(id) || 0);
    }
  }
  window.addEventListener("hashchange", () => render());
  render(true);
}
