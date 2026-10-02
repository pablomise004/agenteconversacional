// Paleta de comandos (Ctrl+K): saltar a cualquier página, intención o entidad,
// lanzar acciones o probar una frase sin tocar el ratón.
import { h, icon, avatar, clear, fold, toggleTheme } from "./ui.js";
import { state, navigate, agentPath, openSimulator } from "./app.js";
import { createIntent } from "./pages/intents.js";
import { createEntity } from "./pages/entities.js";
import { createAgentDialog, splitAgents } from "./pages/agents.js";

const PAGES = [
  ["intents", "Intenciones", "chat"], ["entities", "Entidades", "tag"], ["analyzer", "Analizador", "text"],
  ["learn", "Entrenar", "pulse"], ["training", "Revisión", "training"], ["history", "Historial", "history"],
  ["integrations", "Integraciones", "plug"], ["settings", "Ajustes", "settings"], ["guide", "Guía", "book"],
];

let isOpen = false;

// Puntuación de coincidencia: exacta > empieza por > al principio de palabra > dentro > letras en orden
function score(label, q) {
  if (!q) return 1;
  const l = fold(label);
  if (l === q) return 100;
  if (l.startsWith(q)) return 80;
  const i = l.indexOf(q);
  if (i >= 0) return /[\s._@\-«(]/.test(l[i - 1]) ? 60 : 40;
  let j = 0;
  for (const ch of l) if (ch === q[j]) j++;
  return j === q.length ? 10 : 0;
}

// Resalta la parte que coincide (la búsqueda ignora tildes y mayúsculas)
function highlight(label, q) {
  const i = q ? fold(label).indexOf(q) : -1;
  if (i < 0 || fold(label).length !== label.length) return label;
  return [label.slice(0, i), h("mark", null, label.slice(i, i + q.length)), label.slice(i + q.length)];
}

function groups(raw) {
  const a = state.agent;
  const q = fold(raw.trim());
  const out = [];
  const nav = a ? PAGES.map(([key, label, ic]) => ({ label, icon: ic, hint: "Ir a", run: () => navigate(agentPath(key)) })) : [
    { label: "Guía de uso", icon: "book", hint: "Ir a", run: () => navigate("#/guide") }];
  nav.push({ label: "Todos los agentes", icon: "layers", hint: "Ir a", run: () => navigate("#/agents") });
  nav.push({ label: "Referencia de la API", icon: "code", hint: "/docs", run: () => window.open("/docs", "_blank", "noopener") });
  out.push({ title: "Ir a", items: nav });
  if (a) {
    const intents = [...a.intents].sort((x, y) => x.name.localeCompare(y.name, "es"));
    out.push({ title: "Intenciones", limit: q ? 8 : 5, items: intents.map((i) => ({
      label: i.name, icon: i.isFallback ? "alert" : "chat", hint: `${i.trainingPhrases.length} frases`,
      run: () => navigate(agentPath("intents/" + encodeURIComponent(i.id))) })) });
    out.push({ title: "Entidades", limit: q ? 6 : 3, items: a.entities.map((e) => ({
      label: "@" + e.name, icon: "tag", hint: `${e.entries.length} valores`,
      run: () => navigate(agentPath("entities/" + encodeURIComponent(e.id))) })) });
  }
  const { mine, examples } = splitAgents(state.agents);
  const others = [...mine, ...examples].filter((x) => !a || x.id !== a.id);
  if (others.length) {
    out.push({ title: "Agentes", limit: q ? 6 : 3, items: others.map((x) => ({
      label: x.name, avatar: x.name, hint: x.example ? "Ejemplo" : "Abrir agente",
      run: () => navigate(`#/a/${encodeURIComponent(x.id)}/intents`) })) });
  }
  const actions = [];
  if (a) {
    actions.push({ label: "Crear intención", icon: "plus", run: () => createIntent() });
    actions.push({ label: "Crear entidad", icon: "plus", run: () => createEntity() });
    actions.push({ label: "Abrir el simulador", icon: "message", run: () => openSimulator() });
  }
  actions.push({ label: "Nuevo agente", icon: "plus", run: () => createAgentDialog() });
  actions.push({ label: "Cambiar tema claro u oscuro", icon: "moon", run: () => toggleTheme() });
  out.push({ title: "Acciones", items: actions });

  // filtrar y ordenar por parecido
  const result = [];
  for (const g of out) {
    const items = g.items.map((it) => ({ ...it, score: score(it.label, q) })).filter((it) => it.score > 0);
    if (q) items.sort((x, y) => y.score - x.score);
    if (items.length) result.push({ ...g, items: items.slice(0, g.limit || items.length) });
  }
  if (q) result.sort((x, y) => Math.max(...y.items.map((i) => i.score)) - Math.max(...x.items.map((i) => i.score)));

  // con texto escrito: frases de entrenamiento que lo contienen y acciones para probarlo
  if (q && a) {
    const phrases = [];
    for (const i of a.intents) {
      for (const p of i.trainingPhrases) {
        if (fold(p.text).includes(q)) phrases.push({ label: p.text, icon: "list", hint: i.name,
          run: () => navigate(agentPath("intents/" + encodeURIComponent(i.id))) });
      }
    }
    if (phrases.length) result.push({ title: "Frases de entrenamiento", items: phrases.slice(0, 5) });
    const text = raw.trim();
    result.push({ title: "Con esta frase", items: [
      { label: `Analizar «${text}»`, icon: "text", hint: "Analizador", run: () => navigate(agentPath("analyzer") + "?q=" + encodeURIComponent(text)) },
      { label: `Probar «${text}» en el simulador`, icon: "send", hint: "Pruébalo", run: () => openSimulator(text) },
      { label: `Explicar «${text}» paso a paso`, icon: "pulse", hint: "Entrenar", run: () => navigate(agentPath("learn") + "?q=" + encodeURIComponent(text)) },
    ] });
  }
  return { result, q };
}

export function openPalette() {
  if (isOpen) return;
  isOpen = true;
  const prevFocus = document.activeElement;
  let active = 0;
  let flat = [];
  const input = h("input", { type: "text", placeholder: "Busca una página, intención o entidad… o escribe una frase",
    "aria-label": "Buscar", autocomplete: "off", spellcheck: "false", role: "combobox", "aria-expanded": "true", "aria-controls": "cmdk-list" });
  const list = h("div", { class: "cmdk-list", id: "cmdk-list", role: "listbox" });
  const box = h("div", { class: "cmdk", role: "dialog", "aria-modal": "true", "aria-label": "Buscar y saltar" },
    h("div", { class: "cmdk-input" }, icon("search"), input, h("kbd", null, "Esc")),
    list,
    h("div", { class: "cmdk-foot" },
      h("span", null, h("kbd", null, "↑"), h("kbd", null, "↓"), "moverse"),
      h("span", null, h("kbd", null, "Enter"), "abrir"),
      h("span", null, h("kbd", null, "Esc"), "cerrar")));
  const back = h("div", { class: "cmdk-back", onmousedown: (e) => { if (e.target === back) close(); } }, box);

  const setActive = (i, scroll = true) => {
    active = Math.max(0, Math.min(flat.length - 1, i));
    flat.forEach((b, j) => { b.classList.toggle("active", j === active); b.setAttribute("aria-selected", String(j === active)); });
    if (scroll && flat[active]) flat[active].scrollIntoView({ block: "nearest" });
  };
  const render = () => {
    const { result, q } = groups(input.value);
    clear(list);
    flat = [];
    for (const g of result) {
      list.append(h("div", { class: "cmdk-group" }, g.title));
      for (const it of g.items) {
        const idx = flat.length;
        const btn = h("button", { type: "button", class: "cmdk-item", role: "option", tabindex: "-1",
          onclick: () => run(it), onpointermove: () => { if (active !== idx) setActive(idx, false); } },
        h("span", { class: "ci-icon" }, it.avatar ? avatar(it.avatar, "sm") : icon(it.icon)),
        h("span", { class: "ci-label" }, highlight(it.label, q)),
        it.hint ? h("span", { class: "ci-hint" }, it.hint) : null,
        icon("enter", "ci-enter"));
        flat.push(btn);
        list.append(btn);
      }
    }
    if (!flat.length) list.append(h("div", { class: "cmdk-empty" }, "Nada coincide. Prueba con otra palabra."));
    setActive(0, false);
  };
  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    back.classList.add("leaving");
    box.setAttribute("inert", "");
    setTimeout(() => back.remove(), 150);
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  };
  const run = (it) => {
    close();
    setTimeout(() => it.run(), 0);
  };
  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
    else if (e.key === "Enter") { e.preventDefault(); if (flat[active]) flat[active].click(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "Tab") e.preventDefault();
  });
  render();
  document.body.append(back);
  input.focus();
}
