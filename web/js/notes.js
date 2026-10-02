// Notas de la versión: docs/NOVEDADES.md en una ventana, al pulsar el número de versión (en la
// consola y en la referencia de la API). Un punto en el número avisa de que hay novedades sin ver.
import { h, modal, stagger } from "./ui.js";
import { renderMarkdown } from "./markdown.js";

const SEEN_KEY = "agente.seenVersion";

function compare(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function lastSeen() {
  try { return localStorage.getItem(SEEN_KEY); } catch (err) { return null; }
}

function markSeen(version) {
  try { localStorage.setItem(SEEN_KEY, version); } catch (err) { /* sin almacenamiento local */ }
}

// El número de versión como botón. La primera vez no avisa de nada (para quien acaba de llegar todo
// es nuevo); después, si la versión es más nueva que la última cuyas notas se vieron, lleva el punto.
export function versionButton(version, cls = "") {
  const seen = lastSeen();
  if (!seen) markSeen(version);
  const unseen = !!seen && compare(version, seen) > 0;
  const btn = h("button", {
    class: "version" + (unseen ? " new" : "") + (cls ? " " + cls : ""), type: "button",
    title: unseen ? "Hay novedades: pulsa para verlas" : "Novedades de cada versión",
    "aria-label": `Versión ${version}: ver las novedades`,
    onclick: () => { btn.classList.remove("new"); btn.title = "Novedades de cada versión"; openReleaseNotes(version); },
  }, "v" + version);
  return btn;
}

// «## 0.8.0 · 2 de octubre de 2026» abre cada versión; lo que va debajo es su texto
function parse(md) {
  const releases = [];
  for (const line of md.split("\n")) {
    const m = /^## +(\S+)(?: +· +(.+))?$/.exec(line.trim());
    if (m) releases.push({ version: m[1], date: m[2] || "", lines: [] });
    else if (releases.length) releases[releases.length - 1].lines.push(line);
  }
  return releases.map((r) => ({ ...r, text: r.lines.join("\n").trim() }));
}

function release(r, current) {
  const mine = r.version === current;
  return h("section", { class: "note-rel" + (mine ? " current" : "") },
    h("div", { class: "note-head" },
      h("span", { class: "note-ver" }, r.version),
      mine ? h("span", { class: "badge primary" }, "Tu versión") : null,
      h("span", { class: "note-date" }, r.date)),
    renderMarkdown(r.text).el);
}

export async function openReleaseNotes(version) {
  markSeen(version);
  const list = h("div", { class: "notes", "aria-busy": "true" }, h("p", { class: "muted small" }, "Cargando…"));
  modal({ title: "Novedades", body: list });
  try {
    const res = await fetch("/guia/NOVEDADES.md");
    if (!res.ok) throw new Error(res.statusText);
    const releases = parse(await res.text());
    if (!releases.length) throw new Error("vacío");
    list.replaceChildren(...releases.map((r) => release(r, version)));
    stagger(list, 6);
  } catch (err) {
    list.replaceChildren(h("p", { class: "muted" }, "No se han podido cargar las novedades."));
  } finally {
    list.removeAttribute("aria-busy");
  }
}
