// Lista de agentes: crear, importar (JSON o ZIP de Dialogflow) y abrir.
import { api } from "../api.js";
import { h, icon, modal, toast, errorToast, timeAgo } from "../ui.js";
import { navigate, refreshAgents, state } from "../app.js";

export async function createAgentDialog() {
  const name = h("input", { type: "text", placeholder: "Por ejemplo: Atención al cliente" });
  const lang = h("select", null, Object.entries(state.info.languages).map(([k, v]) => h("option", { value: k }, v)));
  const tpl = h("select", null,
    h("option", { value: "blank" }, "Vacío (bienvenida + fallback)"),
    h("option", { value: "pizzeria" }, "Copia del ejemplo de la pizzería"));
  const desc = h("input", { type: "text", placeholder: "Opcional" });
  const result = await modal({
    title: "Nuevo agente",
    body: [
      h("label", { class: "field" }, "Nombre", name),
      h("label", { class: "field" }, "Descripción", desc),
      h("div", { class: "grid-2" }, h("label", { class: "field" }, "Idioma", lang), h("label", { class: "field" }, "Plantilla", tpl)),
    ],
    actions: [
      { label: "Cancelar", value: null },
      { label: "Crear agente", primary: true, validate: () => { if (!name.value.trim()) { name.focus(); return false; } return true; },
        value: () => ({ name: name.value.trim(), language: lang.value, description: desc.value.trim(), template: tpl.value }) },
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

export async function render(el) {
  const agents = await api.agents();
  state.agents = agents;
  const page = h("div", { class: "page" },
    h("div", { class: "page-head" },
      h("div", { class: "grow" }, h("h1", null, "Agentes"),
        h("div", { class: "sub" }, "Cada agente es un chatbot con sus intenciones, entidades y respuestas.")),
      h("button", { class: "btn", type: "button", onclick: importAgentDialog, title: "JSON exportado de aquí o ZIP exportado de Dialogflow ES" }, icon("upload"), "Importar"),
      h("button", { class: "btn primary", type: "button", onclick: createAgentDialog }, icon("plus"), "Crear agente")));
  if (!agents.length) {
    page.append(h("div", { class: "card" }, h("div", { class: "empty" }, icon("bot"),
      h("p", null, "Todavía no hay agentes."),
      h("button", { class: "btn primary", type: "button", onclick: createAgentDialog }, icon("plus"), "Crear el primero"))));
  } else {
    page.append(h("div", { class: "agent-cards" }, agents.map((a) => h("div", {
      class: "card agent-card", tabindex: "0", role: "link",
      onclick: () => navigate(`#/a/${encodeURIComponent(a.id)}/intents`),
      onkeydown: (e) => { if (e.key === "Enter") navigate(`#/a/${encodeURIComponent(a.id)}/intents`); },
    },
      h("div", { class: "row" }, h("h3", { class: "grow" }, a.name), h("span", { class: "badge" }, a.language.toUpperCase())),
      a.description ? h("div", { class: "muted small" }, a.description) : null,
      h("div", { class: "row wrap small muted" },
        h("span", null, `${a.intents} intenciones`), "·", h("span", null, `${a.entities} entidades`), "·",
        h("span", null, `${a.phrases} frases`)),
      h("div", { class: "faint small" }, "Modificado " + timeAgo(a.updatedAt))))));
  }
  page.append(h("div", { class: "notice info", style: { marginTop: "18px" } }, icon("info"),
    h("div", null, "¿Vienes de Dialogflow? En la consola de Dialogflow ES ve a ", h("b", null, "Configuración del agente → Exportar e importar → Exportar como ZIP"),
      " y usa el botón ", h("b", null, "Importar"), " de aquí. Se conservan intenciones, frases con anotaciones, entidades, contextos, parámetros y respuestas.")));
  el.append(page);
}
