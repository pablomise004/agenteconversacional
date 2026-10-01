// Lista de intenciones del agente.
import { api } from "../api.js";
import { h, icon, clear, confirmDialog, promptDialog, toast, errorToast } from "../ui.js";
import { agentPath, navigate, replaceInAgent, state } from "../app.js";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export async function createIntent(name) {
  if (!name) name = await promptDialog("Nueva intención", { label: "Nombre", placeholder: "Por ejemplo: pedido.estado", okLabel: "Crear" });
  if (!name) return null;
  try {
    const intent = await api.createIntent(state.agent.id, { name });
    replaceInAgent("intents", intent);
    navigate(agentPath("intents/" + encodeURIComponent(intent.id)));
    return intent;
  } catch (e) { errorToast(e); return null; }
}

export function validationCard(items, onOpen) {
  if (!items || !items.length) return null;
  const errors = items.filter((i) => i.level === "error").length;
  const warnings = items.filter((i) => i.level === "warning").length;
  const list = h("div", { class: "card-body hidden" }, items.map((it) => h("div", { class: "validation-item" },
    h("span", { class: "badge " + (it.level === "error" ? "danger" : it.level === "warning" ? "warning" : "") },
      it.level === "error" ? "error" : it.level === "warning" ? "aviso" : "info"),
    h("div", { class: "grow" },
      it.intentName ? h("a", { href: "#", onclick: (e) => { e.preventDefault(); onOpen(it); } }, it.intentName) : null,
      it.entityName ? h("a", { href: "#", onclick: (e) => { e.preventDefault(); onOpen(it); } }, "@" + it.entityName) : null,
      it.intentName || it.entityName ? ": " : "", it.message))));
  const head = h("button", { type: "button", class: "card-head", style: { width: "100%", border: 0, background: "transparent",
    cursor: "pointer", font: "inherit", color: "inherit", paddingBottom: "14px" },
    onclick: () => list.classList.toggle("hidden") },
    icon("alert"), h("h2", null, "Revisión del agente"),
    errors ? h("span", { class: "badge danger" }, `${errors} errores`) : null,
    warnings ? h("span", { class: "badge warning" }, `${warnings} avisos`) : null,
    h("span", { class: "spacer" }), h("span", { class: "muted small" }, "ver"), icon("down"));
  return h("div", { class: "card", style: { marginBottom: "14px" } }, head, list);
}

export async function render(el) {
  const agent = state.agent;
  const search = h("input", { type: "search", placeholder: "Buscar intención o frase…", "aria-label": "Buscar", style: { width: "240px" } });
  const listBox = h("div", { class: "list" });
  const valBox = h("div");
  const page = h("div", { class: "page" },
    h("div", { class: "page-head" },
      h("div", { class: "grow" }, h("h1", null, "Intenciones"),
        h("div", { class: "sub" }, "Lo que el usuario quiere hacer. Cada intención tiene frases de ejemplo y respuestas.")),
      search,
      h("button", { class: "btn primary", type: "button", onclick: () => createIntent() }, icon("plus"), "Crear intención")),
    valBox,
    h("div", { class: "card" }, listBox));

  const draw = () => {
    clear(listBox);
    const q = search.value.trim().toLowerCase();
    const intents = [...agent.intents]
      .filter((i) => !q || i.name.toLowerCase().includes(q) || i.trainingPhrases.some((p) => p.text.toLowerCase().includes(q)))
      .sort((a, b) => (b.isFallback - a.isFallback) || a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
    if (!intents.length) {
      listBox.append(h("div", { class: "empty" }, q ? "Ninguna intención coincide con la búsqueda." : "No hay intenciones todavía."));
      return;
    }
    for (const it of intents) {
      const open = () => navigate(agentPath("intents/" + encodeURIComponent(it.id)));
      listBox.append(h("div", { class: "list-item", tabindex: "0", role: "link", onclick: open,
        onkeydown: (e) => { if (e.key === "Enter") open(); } },
        h("div", { class: "grow col", style: { gap: "4px" } },
          h("div", { class: "title" }, it.name),
          h("div", { class: "meta" },
            it.isFallback ? h("span", { class: "badge warning" }, "fallback") : null,
            it.events.map((e) => h("span", { class: "badge primary", title: "Evento" }, "⚡ " + e)),
            it.inputContexts.map((c) => h("span", { class: "badge outline ctx-in", title: "Contexto de entrada" }, " " + c)),
            it.outputContexts.map((c) => h("span", { class: "badge outline ctx-out", title: `Contexto de salida (${c.lifespan} turnos)` }, c.name + " ")),
            it.webhook ? h("span", { class: "badge", title: "Llama al webhook" }, icon("zap"), "webhook") : null,
            it.endConversation ? h("span", { class: "badge" }, "fin") : null,
            it.parameters.filter((p) => p.required).length
              ? h("span", { class: "badge" }, plural(it.parameters.filter((p) => p.required).length, "obligatorio", "obligatorios")) : null)),
        h("span", { class: "muted small nowrap" }, plural(it.trainingPhrases.length, "frase", "frases")),
        h("div", { class: "actions" }, h("button", { class: "btn ghost sm icon-only", type: "button", title: "Borrar",
          "aria-label": "Borrar " + it.name, onclick: async (e) => {
            e.stopPropagation();
            if (!await confirmDialog(`Se borrará la intención «${it.name}» con sus ${it.trainingPhrases.length} frases.`,
              { title: "Borrar intención", okLabel: "Borrar", danger: true })) return;
            try {
              await api.deleteIntent(agent.id, it.id);
              replaceInAgent("intents", null, it.id);
              toast("Intención borrada", "success");
              draw();
            } catch (err) { errorToast(err); }
          } }, icon("trash")))));
    }
  };
  search.addEventListener("input", draw);
  draw();
  el.append(page);
  api.validate(agent.id).then((items) => {
    const card = validationCard(items, (it) => {
      if (it.intentId) navigate(agentPath("intents/" + encodeURIComponent(it.intentId)));
      else if (it.entityId) navigate(agentPath("entities/" + encodeURIComponent(it.entityId)));
    });
    if (card) valBox.append(card);
  }).catch(() => {});
  search.focus();
}
