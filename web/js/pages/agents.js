// Lista de agentes: crear, importar (JSON o ZIP de Dialogflow) y abrir.
import { api } from "../api.js";
import { h, icon, avatar, modal, toast, errorToast, timeAgo, fullDate, pageHead, emptyState, stagger } from "../ui.js";
import { navigate, refreshAgents, state } from "../app.js";

const TEMPLATES = [
  { value: "blank", icon: "sparkle", title: "Vacío", text: "Solo bienvenida y fallback. Para empezar de cero." },
  { value: "pizzeria", icon: "chat", title: "Copia de la pizzería", text: "Pequeña y fácil de seguir: pedidos, reservas y carta. Para aprender." },
  { value: "hotel", icon: "key", title: "Copia del hotel", text: "El ejemplo grande: 88 intenciones y más de 2.000 frases. Para ver hasta dónde llega." },
];

export async function createAgentDialog() {
  const name = h("input", { type: "text", placeholder: "Por ejemplo: Atención al cliente" });
  const lang = h("select", null, Object.entries(state.info.languages).map(([k, v]) => h("option", { value: k }, v)));
  const desc = h("input", { type: "text", placeholder: "Opcional" });
  let template = "blank";
  const tplBox = h("div", { class: "tpl-list", role: "radiogroup", "aria-label": "Plantilla" }, TEMPLATES.map((t) => {
    const radio = h("input", { type: "radio", name: "tpl", value: t.value, checked: t.value === template, class: "sr-only",
      onchange: () => { template = t.value; paint(); } });
    return h("label", { class: "tpl-card" + (t.value === template ? " on" : ""), dataset: { value: t.value } }, radio,
      h("span", { class: "li-icon primary" }, icon(t.icon)),
      h("span", null, h("b", null, t.title), h("span", { class: "muted small", style: { display: "block" } }, t.text)));
  }));
  const paint = () => tplBox.querySelectorAll(".tpl-card").forEach((c) => c.classList.toggle("on", c.dataset.value === template));
  const result = await modal({
    title: "Nuevo agente",
    body: [
      h("label", { class: "field" }, "Nombre", name),
      h("label", { class: "field" }, "Descripción", desc),
      h("label", { class: "field" }, "Idioma", lang),
      h("div", { class: "field" }, h("span", null, "Plantilla"), tplBox),
    ],
    actions: [
      { label: "Cancelar", value: null },
      { label: "Crear agente", primary: true, validate: () => { if (!name.value.trim()) { name.focus(); return false; } return true; },
        value: () => ({ name: name.value.trim(), language: lang.value, description: desc.value.trim(), template }) },
    ],
  });
  if (!result) return;
  try {
    const agent = await api.createAgent(result);
    await refreshAgents();
    toast("Agente creado", "success");
    navigate(`#/a/${encodeURIComponent(agent.id)}/intents`);
  } catch (e) { errorToast(e); }
}

export function importAgentDialog() {
  const file = h("input", { type: "file", accept: ".json,.zip,application/json,application/zip" });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      const agent = await api.importAgent(f);
      await refreshAgents();
      toast(`Importado «${agent.name}»: ${agent.intents.length} intenciones, ${agent.entities.length} entidades`, "success", 4000);
      navigate(`#/a/${encodeURIComponent(agent.id)}/intents`);
    } catch (e) { errorToast(e); }
  });
  file.click();
}

function agentCard(a) {
  const open = () => navigate(`#/a/${encodeURIComponent(a.id)}/intents`);
  const langName = (state.info.languages || {})[a.language] || a.language;
  return h("div", { class: "card agent-card", tabindex: "0", role: "link", "aria-label": "Abrir " + a.name,
    onclick: open, onkeydown: (e) => { if (e.key === "Enter") open(); } },
  h("div", { class: "row", style: { gap: "12px" } }, avatar(a.name, "lg"),
    h("div", { class: "grow" }, h("h3", { class: "ellipsis" }, a.name), h("div", { class: "faint small" }, langName)),
    h("span", { class: "badge outline" }, a.language.toUpperCase())),
  a.description ? h("div", { class: "desc" }, a.description) : null,
  h("div", { class: "stats" },
    h("span", null, icon("chat"), `${a.intents} intenciones`),
    h("span", null, icon("tag"), `${a.entities} entidades`),
    h("span", null, icon("list"), `${a.phrases} frases`)),
  h("div", { class: "foot" }, h("span", { title: fullDate(a.updatedAt) }, "Modificado " + timeAgo(a.updatedAt)),
    h("span", { class: "open" }, "Abrir", icon("arrowRight"))));
}

// Los agentes de ejemplo (pizzería y hotel) van aparte, del más sencillo al más grande
export function splitAgents(agents) {
  return {
    mine: agents.filter((a) => !a.example),
    examples: agents.filter((a) => a.example).sort((x, y) => x.intents - y.intents),
  };
}

// Un grupo de la lista: título, cuántos hay, para qué sirven (si hace falta) y su contenido
function group({ icon: ic, title, count, help, key }, content) {
  return h("section", { class: "agent-group", dataset: { group: key }, "aria-label": title },
    h("div", { class: "section-head" },
      h("h2", null, icon(ic), title, count ? h("span", { class: "badge" }, String(count)) : null),
      help ? h("p", null, help) : null),
    content);
}

export async function render(el) {
  const agents = await api.agents();
  state.agents = agents;
  const { mine, examples } = splitAgents(agents);
  const page = h("div", { class: "page" },
    pageHead({
      icon: "layers", title: "Agentes", sub: "Cada agente es un chatbot con sus intenciones, entidades y respuestas.",
      actions: [
        h("button", { class: "btn", type: "button", onclick: importAgentDialog, title: "JSON exportado de aquí o ZIP exportado de Dialogflow ES" }, icon("upload"), "Importar"),
        h("button", { class: "btn primary", type: "button", onclick: createAgentDialog }, icon("plus"), "Crear agente")],
    }));
  let grid = null;
  if (mine.length) {
    grid = h("div", { class: "agent-cards" }, mine.map(agentCard),
      h("button", { class: "card agent-card new", type: "button", onclick: createAgentDialog },
        h("span", { class: "plus" }, icon("plus")), "Nuevo agente"));
  }
  page.append(group({ key: "mine", icon: "bot", title: "Tus agentes", count: mine.length }, grid ||
    h("div", { class: "card agents-empty" }, emptyState({
      icon: "bot", title: "Todavía no tienes agentes",
      text: "Crea el primero desde cero o a partir de un ejemplo, o importa uno exportado de Dialogflow.",
      action: h("button", { class: "btn primary", type: "button", onclick: createAgentDialog }, icon("plus"), "Crear el primero") }))));
  if (grid) stagger(grid);
  if (examples.length) {
    const exGrid = h("div", { class: "agent-cards" }, examples.map(agentCard));
    page.append(group({ key: "examples", icon: "book", title: "Ejemplos", count: examples.length,
      help: "Para aprender cómo se hace un agente y ver hasta dónde llega Lince. Ábrelos, pruébalos y cámbialos cuanto " +
        "quieras: en «Crear agente» siempre puedes sacar una copia nueva." }, exGrid));
    stagger(exGrid);
  }
  page.append(h("div", { class: "notice info", style: { marginTop: "20px" } }, icon("info"),
    h("div", null, h("b", null, "¿Vienes de Dialogflow? "), "En la consola de Dialogflow ES ve a ", h("b", null, "Configuración del agente → Exportar e importar → Exportar como ZIP"),
      " y usa el botón ", h("b", null, "Importar"), " de aquí. Se conservan intenciones, frases con anotaciones, entidades, contextos, parámetros y respuestas.")));
  el.append(page);
}
