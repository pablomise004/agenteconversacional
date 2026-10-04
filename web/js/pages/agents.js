// Lista de agentes: crear, importar (JSON o ZIP de Dialogflow) y abrir.
import { api, getUser } from "../api.js";
import { h, icon, avatar, clear, modal, popover, closePopover, optionList, selectMenu, toast, errorToast, timeAgo, fullDate,
  pageHead, emptyState, stagger } from "../ui.js";
import { navigate, refreshAgents, state } from "../app.js";

// Un agente nuevo empieza vacío o como copia de otro: de los tuyos, de uno de ejemplo o, si borraste
// un ejemplo, del original tal como viene (state.info.examples).
const STARTS = [
  { value: "blank", icon: "sparkle", title: "Vacío", text: "Solo bienvenida y fallback, para empezar de cero." },
  { value: "copy", icon: "copy", title: "Copia de un agente", text: "De uno tuyo o de un ejemplo, con todo lo que tiene." },
];

// Lo que se puede copiar, por grupos, como en el menú de agentes
function copySources() {
  const { mine, examples } = splitAgents(state.agents);
  const sub = (n, lang) => `${n} ${n === 1 ? "intención" : "intenciones"} · ${(lang || "es").toUpperCase()}`;
  const option = (a) => ({ value: "agent:" + a.id, label: a.name, avatar: a.name, sub: sub(a.intents, a.language), example: !!a.example });
  const originals = ((state.info && state.info.examples) || [])
    .filter((t) => !examples.some((a) => a.id === t.id || a.name === t.name))
    .map((t) => ({ value: "template:" + t.id, label: t.name, avatar: t.name, sub: "Original · " + sub(t.intents, t.language), example: true }));
  return [{ title: "Tus agentes", options: mine.map(option) }, { title: "Ejemplos", options: [...examples.map(option), ...originals] }]
    .filter((g) => g.options.length);
}

// Nombre que se propone para la copia: el del ejemplo sin «(ejemplo)» o el del agente con «(copia)»
const copyName = (o) => (o.example ? o.label.replace(/\s*\(ejemplo\)\s*$/i, "") : o.label + " (copia)");

export async function createAgentDialog() {
  const name = h("input", { type: "text" });
  const desc = h("input", { type: "text", placeholder: "Opcional" });
  const lang = selectMenu({ label: "Idioma", value: "es", options: Object.entries(state.info.languages).map(([k, v]) => ({ value: k, label: v })) });
  const groups = copySources();
  const sources = groups.flatMap((g) => g.options);
  let start = "blank";
  let source = sources[0] || null;

  // el agente que se copia se elige como en el menú de agentes: con buscador y por grupos
  const pick = h("button", { class: "agent-switch source-pick", type: "button", "aria-haspopup": "listbox", "aria-expanded": "false",
    onclick: () => popover(pick, h("div", { class: "agent-menu" }, optionList({
      groups: groups.map((g) => ({ ...g, options: g.options.map((o) => ({ ...o, selected: o === source })) })),
      placeholder: "Buscar agente…",
      onPick: (value) => { source = sources.find((o) => o.value === value) || source; closePopover(); paint(); pick.focus(); },
    })), { width: pick.offsetWidth }) });
  const langField = h("div", { class: "field swap" }, h("span", null, "Idioma"), lang);
  const sourceField = h("div", { class: "field swap" }, h("span", null, "Copiar de"), pick,
    h("span", { class: "hint" }, "La copia es tuya: lo que cambies en ella no toca el original."));
  const cards = h("div", { class: "tpl-list two", role: "radiogroup", "aria-label": "Punto de partida" }, STARTS.map((t) => {
    const radio = h("input", { type: "radio", name: "start", value: t.value, checked: t.value === start, class: "sr-only",
      disabled: t.value === "copy" && !source, onchange: () => { start = t.value; paint(); } });
    return h("label", { class: "tpl-card", dataset: { value: t.value } }, radio,
      h("span", { class: "li-icon primary" }, icon(t.icon)),
      h("span", null, h("b", null, t.title), h("span", { class: "muted small", style: { display: "block" } }, t.text)));
  }));
  function paint() {
    const copy = start === "copy";
    cards.querySelectorAll(".tpl-card").forEach((c) => c.classList.toggle("on", c.dataset.value === start));
    langField.hidden = copy;
    sourceField.hidden = !copy;
    name.placeholder = copy ? copyName(source) : "Por ejemplo: Atención al cliente";
    if (source) {
      clear(pick);
      pick.append(avatar(source.label), h("span", { class: "grow" }, h("div", { class: "name ellipsis" }, source.label),
        h("div", { class: "meta ellipsis" }, source.sub)), icon("chevUpDown"));
    }
  }
  paint();
  const result = await modal({
    title: "Nuevo agente",
    body: [
      h("label", { class: "field" }, "Nombre", name),
      h("label", { class: "field" }, "Descripción", desc),
      h("div", { class: "field" }, h("span", null, "Punto de partida"), cards),
      langField,
      sourceField,
    ],
    actions: [
      { label: "Cancelar", value: null },
      { label: "Crear agente", primary: true,
        validate: () => { if (start === "blank" && !name.value.trim()) { name.focus(); return false; } return true; },
        value: () => {
          const body = { name: name.value.trim(), description: desc.value.trim() };
          if (start === "blank") return { ...body, language: lang.value, template: "blank" };
          // en una copia, sin nombre vale el que se propone
          body.name = body.name || copyName(source);
          const cut = source.value.indexOf(":");
          const [kind, id] = [source.value.slice(0, cut), source.value.slice(cut + 1)];
          return kind === "agent" ? { ...body, copyOf: id } : { ...body, template: id };
        } },
    ],
  });
  if (!result) return;
  try {
    const agent = await api.createAgent(result);
    await refreshAgents();
    toast(result.template === "blank" ? "Agente creado" : "Copia creada", "success");
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
  const privacy = !state.info.accounts ? null : getUser()
    ? "Solo los ves tú. Para pasarle uno a alguien, ábrelo y ve a Ajustes → Compartir: le llegará una copia."
    : "Estás sin cuenta: solo se ven en este navegador. Para llevarte uno a otro ordenador, expórtalo e impórtalo allí (Ajustes).";
  page.append(group({ key: "mine", icon: "bot", title: "Tus agentes", count: mine.length, help: privacy }, grid ||
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
