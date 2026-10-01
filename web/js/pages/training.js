// Revisión: revisar mensajes reales y enseñar al bot.
import { api } from "../api.js";
import { h, icon, clear, append, toast, errorToast, timeAgo, fullDate, pct, debounce, confirmDialog } from "../ui.js";
import { annotatedPhrase, colorMap, suggestParam } from "../annotate.js";
import { agentPath, refreshPending, reloadAgent, state } from "../app.js";

const FILTERS = [
  { key: "pending", label: "Pendientes", params: { review: "pending" } },
  { key: "fallback", label: "No entendidas", params: { review: "pending", fallback: "true" } },
  { key: "low", label: "Confianza baja", params: { review: "pending", lowConfidence: "0.6" } },
  { key: "ignored", label: "Ignoradas", params: { review: "ignored" } },
  { key: "all", label: "Todas", params: { review: "" } },
];
const PAGE = 30;

export async function render(el) {
  let filter = FILTERS[0];
  let offset = 0;
  let total = 0;
  const listBox = h("div", { class: "list" });
  const moreBox = h("div", { style: { textAlign: "center", padding: "10px" } });
  const counter = h("span", { class: "badge" });
  const search = h("input", { type: "search", placeholder: "Buscar texto…", "aria-label": "Buscar", style: { width: "200px" } });
  const tabs = h("div", { class: "tabs", role: "tablist" });

  const drawTabs = () => {
    append(clear(tabs), FILTERS.map((f) => h("button", { type: "button", role: "tab", class: f === filter ? "active" : "",
      onclick: () => { filter = f; drawTabs(); load(true); } }, f.label)));
  };

  async function load(reset) {
    if (reset) { offset = 0; clear(listBox); }
    try {
      const params = { ...filter.params, q: search.value.trim(), limit: PAGE, offset };
      const res = await api.logs(state.agent.id, params);
      total = res.total;
      counter.textContent = `${total} mensajes`;
      if (reset && !res.items.length) {
        listBox.append(h("div", { class: "empty" }, icon("training"),
          h("p", null, filter.key === "pending" ? "No hay nada pendiente de revisar. 🎉" : "No hay mensajes con este filtro."),
          h("p", { class: "small" }, "Los mensajes llegan aquí cuando alguien habla con el bot (simulador, widget o API).")));
      }
      for (const log of res.items) listBox.append(logItem(log));
      offset += res.items.length;
      clear(moreBox);
      if (offset < total) moreBox.append(h("button", { class: "btn", type: "button", onclick: () => load(false) }, `Cargar más (${total - offset})`));
    } catch (e) { errorToast(e); }
  }

  function logItem(log) {
    const agent = state.agent;
    const item = h("div", { class: "log-item" });
    const analysis = log.analysis || {};
    const entities = analysis.entities || [];
    const detected = agent.intents.find((i) => i.id === log.intentId);
    const fallbackIntent = agent.intents.find((i) => i.isFallback);
    let selected = detected || fallbackIntent;
    let annotations = [];

    const select = h("select", { "aria-label": "Intención" },
      h("optgroup", { label: "Intenciones" }, agent.intents.filter((i) => !i.isFallback).sort((a, b) => a.name.localeCompare(b.name))
        .map((i) => h("option", { value: i.id, selected: selected && i.id === selected.id }, i.name))),
      h("optgroup", { label: "No debería entenderla" }, agent.intents.filter((i) => i.isFallback)
        .map((i) => h("option", { value: i.id, selected: selected && i.id === selected.id }, i.name + " (fallback)"))));
    const phraseBox = h("div", { class: "grow" });
    const approve = h("button", { class: "btn sm primary", type: "button" }, icon("check"), "Aprobar");

    const mapAnnotations = () => {
      if (!selected || selected.isFallback) return [];
      const used = [];
      return entities.filter((e) => !e.weak).map((e) => {
        const param = suggestParam(e.entity, selected.parameters, used);
        used.push(param);
        return { start: e.start, end: e.end, entity: e.entity, param };
      });
    };
    const drawPhrase = () => {
      clear(phraseBox);
      const params = selected ? selected.parameters : [];
      phraseBox.append(annotatedPhrase({
        text: log.query, annotations, readOnly: !selected || selected.isFallback,
        getParams: () => params, getEntities: () => state.agent.entities,
        systemEntities: state.info.systemEntities, colorOf: colorMap(params),
        onChange: (anns) => { annotations = anns; },
      }));
      const changed = selected && selected.id !== log.intentId;
      clear(approve).append(icon("check"), changed ? `Guardar en «${selected.name}»` : selected && selected.isFallback ? "Correcto: no debe entenderla" : "Aprobar");
    };
    select.addEventListener("change", () => {
      selected = state.agent.intents.find((i) => i.id === select.value);
      annotations = mapAnnotations();
      drawPhrase();
    });
    annotations = mapAnnotations();
    drawPhrase();

    const done = (msg, cls = "success") => {
      clear(item).append(h("div", { class: "notice " + cls }, icon("check"), h("div", null, "«", log.query, "» ", msg)));
      refreshPending();
    };
    approve.addEventListener("click", async () => {
      if (!selected) { toast("Elige una intención", "error"); return; }
      const action = selected.id === log.intentId ? "approve" : "assign";
      try {
        await api.review(state.agent.id, log.id, { action, intentId: selected.id, annotations: selected.isFallback ? [] : annotations });
        await reloadAgent();
        done(selected.isFallback ? "→ guardada como ejemplo negativo (fallback)." : `→ guardada en «${selected.name}».`);
      } catch (e) { errorToast(e); }
    });
    const ignore = h("button", { class: "btn sm ghost", type: "button", title: "Descartar sin enseñar nada",
      onclick: async () => {
        try { await api.review(state.agent.id, log.id, { action: log.review === "ignored" ? "reopen" : "ignore" }); done(log.review === "ignored" ? "vuelve a pendientes." : "ignorada.", "info"); }
        catch (e) { errorToast(e); }
      } }, log.review === "ignored" ? "Recuperar" : "Ignorar");

    const fb = log.isFallback;
    item.append(
      h("div", { class: "row wrap" },
        h("span", { class: "badge " + (fb ? "warning" : log.confidence >= 0.8 ? "success" : "") }, fb ? "no entendida" : pct(log.confidence)),
        h("span", { class: "muted small" }, "Entendida como ", h("b", null, log.intentName || "—")),
        log.review !== "pending" ? h("span", { class: "badge" }, { approved: "aprobada", corrected: "corregida", ignored: "ignorada" }[log.review] || log.review) : null,
        h("span", { class: "spacer" }),
        h("a", { class: "faint small", href: agentPath("history/" + encodeURIComponent(log.sessionId)), title: fullDate(log.ts) },
          timeAgo(log.ts) + " · " + (log.source || "api"))),
      h("div", { class: "phrase-list", style: { marginTop: 0 } }, h("div", { class: "phrase-row" }, h("span", { class: "quote" }, "“"), phraseBox)),
      h("div", { class: "row wrap" }, h("span", { class: "muted small" }, "Intención correcta:"), select, approve, ignore,
        h("a", { class: "btn sm ghost", href: agentPath("analyzer") + "?q=" + encodeURIComponent(log.query) }, icon("text"), "Analizar")));
    return item;
  }

  search.addEventListener("input", debounce(() => load(true), 350));
  // se actualiza sola cuando llegan mensajes nuevos desde el simulador
  const onTurn = debounce(() => { if (filter.params.review === "pending" && !listBox.querySelector(":focus")) load(true); }, 600);
  window.addEventListener("agente:turn", onTurn);
  drawTabs();
  el.append(h("div", { class: "page" },
    h("div", { class: "page-head" },
      h("div", { class: "grow" }, h("h1", null, "Revisión de mensajes"),
        h("div", { class: "sub" }, "Lo que han escrito los usuarios. Aprueba lo que acertó y corrige lo que no: cada revisión se convierte en una frase de entrenamiento.")),
      search,
      h("button", { class: "btn ghost sm icon-only", type: "button", title: "Actualizar", "aria-label": "Actualizar", onclick: () => load(true) }, icon("refresh")),
      h("button", { class: "btn ghost sm", type: "button", title: "Borrar todo el registro de mensajes", onclick: async () => {
        if (!await confirmDialog("Se borrará todo el registro de mensajes y el historial de conversaciones de este agente.", { title: "Vaciar registro", okLabel: "Vaciar", danger: true })) return;
        try { await api.clearLogs(state.agent.id); toast("Registro vaciado", "success"); load(true); refreshPending(); } catch (e) { errorToast(e); }
      } }, icon("trash"), "Vaciar")),
    tabs,
    h("div", { class: "row", style: { marginBottom: "8px" } }, counter),
    h("div", { class: "card" }, listBox, moreBox)));
  await load(true);
  return { destroy: () => window.removeEventListener("agente:turn", onTurn) };
}
