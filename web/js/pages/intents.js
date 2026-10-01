// Lista de intenciones del agente.
import { api } from "../api.js";
import { h, icon, clear, confirmDialog, promptDialog, toast, errorToast, fold, pageHead, emptyState, stagger } from "../ui.js";
import { agentPath, navigate, replaceInAgent, state } from "../app.js";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export async function createIntent(name) {
  if (!name) name = await promptDialog("Nueva intención", { label: "Nombre", placeholder: "Por ejemplo: pedido.estado", okLabel: "Crear",
    hint: "Un nombre corto que describa lo que quiere el usuario. Se suelen agrupar con puntos: info.horario, pedido.estado…" });
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
  const list = h("div", { class: "card-body hidden", style: { paddingTop: 0 } }, items.map((it) => h("div", { class: "validation-item" },
    h("span", { class: "badge " + (it.level === "error" ? "danger" : it.level === "warning" ? "warning" : "") },
      it.level === "error" ? "error" : it.level === "warning" ? "aviso" : "info"),
    h("div", { class: "grow" },
      it.intentName ? h("a", { href: "#", onclick: (e) => { e.preventDefault(); onOpen(it); } }, it.intentName) : null,
      it.entityName ? h("a", { href: "#", onclick: (e) => { e.preventDefault(); onOpen(it); } }, "@" + it.entityName) : null,
      it.intentName || it.entityName ? ": " : "", it.message))));
  const head = h("button", { type: "button", class: "card-head collapsible-head", "aria-expanded": "false",
    onclick: () => {
      list.classList.toggle("hidden");
      head.setAttribute("aria-expanded", String(!list.classList.contains("hidden")));
    } },
  h("span", { class: "li-icon " + (errors ? "warning" : "primary"), style: { width: "30px", height: "30px" } }, icon(errors ? "alert" : "sparkle")),
  h("h2", null, "Revisión del agente"),
  errors ? h("span", { class: "badge danger" }, plural(errors, "error", "errores")) : null,
  warnings ? h("span", { class: "badge warning" }, plural(warnings, "aviso", "avisos")) : null,
  h("span", { class: "spacer" }), h("span", { class: "muted small" }, "consejos para que entienda mejor"), icon("down", "chev"));
  return h("div", { class: "card", style: { marginBottom: "16px" } }, head, list);
}

// Frases de una intención frente a las 10 recomendadas
function phraseMeter(it) {
  const n = it.trainingPhrases.length;
  if (it.isFallback) {
    return h("span", { class: "qty", title: "Ejemplos negativos: frases que NO debe confundir con otra intención" }, plural(n, "ejemplo", "ejemplos"));
  }
  const cls = n >= 10 ? "ok" : n >= 5 ? "" : "low";
  return h("span", { class: "qty " + cls, title: n >= 10 ? "Bien: 10 frases o más" : "Recomendado: al menos 10 frases variadas" },
    h("span", { class: "qty-bar" }, h("span", { style: { width: Math.min(100, n * 10) + "%" } })), plural(n, "frase", "frases"));
}

export async function render(el) {
  const agent = state.agent;
  const search = h("input", { type: "search", placeholder: "Buscar intención o frase…", "aria-label": "Buscar", style: { width: "250px" } });
  const listBox = h("div", { class: "list" });
  const valBox = h("div");
  const total = agent.intents.reduce((s, i) => s + (i.isFallback ? 0 : i.trainingPhrases.length), 0);
  const page = h("div", { class: "page" },
    pageHead({
      icon: "chat", title: "Intenciones",
      sub: `Lo que el usuario quiere hacer. Cada intención tiene frases de ejemplo y respuestas. ${plural(agent.intents.length, "intención", "intenciones")} · ${plural(total, "frase", "frases")}.`,
      actions: [search, h("button", { class: "btn primary", type: "button", onclick: () => createIntent() }, icon("plus"), "Crear intención")],
    }),
    valBox,
    h("div", { class: "card" }, listBox));

  let first = true;
  const draw = () => {
    clear(listBox);
    const q = fold(search.value.trim());
    const intents = [...agent.intents]
      .filter((i) => !q || fold(i.name).includes(q) || i.trainingPhrases.some((p) => fold(p.text).includes(q)))
      .sort((a, b) => (b.isFallback - a.isFallback) || a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
    if (!intents.length) {
      listBox.append(q
        ? emptyState({ icon: "search", title: "Sin resultados", text: "Ninguna intención ni frase contiene ese texto." })
        : emptyState({ icon: "chat", title: "No hay intenciones todavía", text: "Crea la primera: por ejemplo, «saludo» o «info.horario»." }));
      return;
    }
    for (const it of intents) {
      const open = () => navigate(agentPath("intents/" + encodeURIComponent(it.id)));
      const required = it.parameters.filter((p) => p.required).length;
      listBox.append(h("div", { class: "list-item", tabindex: "0", role: "link", onclick: open,
        onkeydown: (e) => { if (e.key === "Enter") open(); } },
      h("span", { class: "li-icon" + (it.isFallback ? " warning" : it.events.length ? " primary" : "") },
        icon(it.isFallback ? "alert" : it.events.length ? "zap" : "chat")),
      h("div", { class: "grow col", style: { gap: "5px" } },
        h("div", { class: "title" }, it.name),
        h("div", { class: "meta" },
          it.isFallback ? h("span", { class: "badge warning" }, "fallback") : null,
          it.events.map((e) => h("span", { class: "badge primary", title: "Evento" }, icon("zap"), e)),
          it.inputContexts.map((c) => h("span", { class: "badge outline ctx-in", title: "Contexto de entrada" }, " " + c)),
          it.outputContexts.map((c) => h("span", { class: "badge outline ctx-out", title: `Contexto de salida (${c.lifespan} turnos)` }, c.name + " ")),
          it.webhook ? h("span", { class: "badge", title: "Llama al webhook" }, icon("plug"), "webhook") : null,
          it.endConversation ? h("span", { class: "badge", title: "Termina la conversación" }, "fin") : null,
          required ? h("span", { class: "badge", title: "Parámetros que el bot pregunta si faltan" }, plural(required, "obligatorio", "obligatorios")) : null)),
      phraseMeter(it),
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
        } }, icon("trash"))),
      icon("chevRight", "chev")));
    }
    if (first) { stagger(listBox); first = false; }
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
