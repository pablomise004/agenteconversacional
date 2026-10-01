// Panel lateral "Pruébalo": conversar con el agente y corregirlo al momento.
import { api } from "./api.js";
import { h, icon, clear, toast, errorToast, formatValue, pct, popover, closePopover, optionList } from "./ui.js";
import { navigate, reloadAgent, state } from "./app.js";

const MATCH_LABEL = {
  exact: "coincidencia exacta", ml: "modelo", slot: "respuesta a pregunta", event: "evento",
  fallback: "no entendida", cancel: "cancelada",
};

function newSession() {
  return "consola-" + Math.random().toString(36).slice(2, 10);
}

export function createSimulator({ getAgent, onClose, onTurn }) {
  let sessionId = newSession();
  let busy = false;
  const body = h("div", { class: "sim-body", "aria-live": "polite" });
  const input = h("input", { type: "text", placeholder: "Escribe un mensaje…", "aria-label": "Mensaje", maxlength: "1000" });
  const sendBtn = h("button", { class: "btn primary icon-only", type: "submit", "aria-label": "Enviar" }, icon("send"));
  const form = h("form", { class: "sim-foot", onsubmit: (e) => { e.preventDefault(); send(input.value); } }, input, sendBtn);

  const el = h("aside", { class: "sim", "aria-label": "Probar el agente" },
    h("div", { class: "sim-head" },
      h("h2", null, "Pruébalo"),
      h("span", { class: "spacer" }),
      h("button", { class: "btn ghost sm", type: "button", title: "Enviar el evento WELCOME (inicio de conversación)",
        onclick: () => send(null, "WELCOME") }, icon("play"), "Inicio"),
      h("button", { class: "btn ghost sm icon-only", type: "button", title: "Nueva conversación", "aria-label": "Nueva conversación",
        onclick: () => reset() }, icon("refresh")),
      h("button", { class: "btn ghost sm icon-only", type: "button", title: "Cerrar", "aria-label": "Cerrar el simulador",
        onclick: onClose }, icon("x"))),
    body, form);

  const scroll = () => { body.scrollTop = body.scrollHeight; };

  function hint() {
    const agent = getAgent();
    clear(body);
    body.append(h("div", { class: "msg system" }, agent
      ? `Escribe algo para probar «${agent.name}». Cada respuesta muestra qué ha entendido; usa ✓ o ✗ para enseñarle.`
      : "Elige un agente para probarlo."));
  }

  async function reset(silent = false) {
    const agent = getAgent();
    const old = sessionId;
    sessionId = newSession();
    hint();
    if (agent && !silent) {
      try { await api.resetSession(agent.id, old, agent.settings.apiKey); } catch (e) { /* da igual */ }
    }
  }

  async function send(text, event) {
    const agent = getAgent();
    if (!agent || busy) return;
    text = (text || "").trim();
    if (!text && !event) return;
    if (body.querySelector(".msg.system")) clear(body);
    body.append(h("div", { class: "msg user" }, text || `⚡ evento ${event}`));
    input.value = "";
    busy = true;
    sendBtn.disabled = true;
    const typing = h("div", { class: "typing" }, "escribiendo…");
    body.append(typing);
    scroll();
    try {
      const r = await api.detect(agent.id, { sessionId, text: text || null, event: event || null, debug: true, source: "consola" },
        agent.settings.apiKey);
      typing.remove();
      renderTurn(r);
      if (onTurn) onTurn(r);
    } catch (e) {
      typing.remove();
      body.append(h("div", { class: "msg system" }, "Error: " + e.message));
    } finally {
      busy = false;
      sendBtn.disabled = false;
      scroll();
      input.focus();
    }
  }

  function renderTurn(r) {
    for (const m of r.messages || []) {
      if (m.type === "text") body.append(h("div", { class: "msg bot" }, m.text));
      else if (m.type === "quickReplies") {
        body.append(h("div", { class: "quick" }, m.items.map((q) => h("button", { type: "button", onclick: () => send(q) }, q))));
      } else if (m.type === "payload") {
        body.append(h("div", { class: "payload" }, h("div", { class: "small faint" }, "Payload personalizado"),
          h("pre", null, JSON.stringify(m.payload, null, 2))));
      }
    }
    if (!r.messages || !r.messages.length) body.append(h("div", { class: "msg system" }, "(sin respuesta configurada)"));
    if (r.previous) body.append(h("div", { class: "msg system" }, "El webhook lanzó el evento " + (r.event || "")));

    const detail = h("div", { class: "turn-detail hidden" });
    let built = false;
    const intentName = r.intent ? r.intent.name : "—";
    const fb = r.match === "fallback" || (r.intent && r.intent.isFallback);
    const meta = h("div", { class: "turn-meta" },
      h("button", { class: "intent-link", type: "button", title: "Ver detalles", onclick: () => {
        if (!built) { buildDetail(detail, r); built = true; }
        detail.classList.toggle("hidden");
        scroll();
      } }, intentName),
      h("span", { class: "badge" + (fb ? " warning" : r.confidence >= 0.8 ? " success" : "") }, pct(r.confidence)),
      h("span", { class: "faint" }, MATCH_LABEL[r.match] || r.match || ""),
      r.queryText && r.logId ? feedbackButtons(r) : null);
    body.append(meta, detail);
  }

  function feedbackButtons(r) {
    const box = h("span", { class: "row", style: { gap: "2px" } });
    const done = (msg) => { clear(box).append(h("span", { class: "badge success" }, icon("check"), msg)); };
    const ok = h("button", { class: "btn ghost sm icon-only ok", type: "button", title: "Correcto: añadir como frase de entrenamiento",
      "aria-label": "Respuesta correcta", onclick: async () => {
        try {
          const res = await api.review(getAgent().id, r.logId, { action: "approve" });
          await reloadAgent();
          done("aprendido");
          toast(`Añadida a «${intentLabel(res.intentId)}»`, "success");
        } catch (e) { errorToast(e); }
      } }, icon("thumbUp"));
    const bad = h("button", { class: "btn ghost sm icon-only", type: "button", title: "Incorrecto: elegir la intención correcta",
      "aria-label": "Respuesta incorrecta", onclick: (ev) => {
        const agent = getAgent();
        const groups = [
          { title: "Intenciones", options: agent.intents.filter((i) => !i.isFallback).map((i) => ({ label: i.name, value: i.id })) },
          { title: "No debería entenderla", options: agent.intents.filter((i) => i.isFallback).map((i) => ({ label: i.name + " (fallback)", value: i.id })) },
        ];
        popover(ev.currentTarget, h("div", null,
          h("div", { class: "pop-head" }, "¿Qué intención era?"),
          optionList({ groups, placeholder: "Buscar intención…", onPick: async (intentId) => {
            closePopover();
            try {
              await api.review(agent.id, r.logId, { action: "assign", intentId });
              await reloadAgent();
              done("corregido");
              toast(`Añadida a «${intentLabel(intentId)}». El bot ya lo tendrá en cuenta.`, "success");
            } catch (e) { errorToast(e); }
          } })));
      } }, icon("thumbDown"));
    box.append(ok, bad);
    return box;
  }

  function intentLabel(id) {
    const agent = getAgent();
    const it = agent && agent.intents.find((i) => i.id === id);
    return it ? it.name : id;
  }

  function buildDetail(detail, r) {
    const kv = h("div", { class: "kv" });
    const row = (k, v) => kv.append(h("div", null, k), h("div", null, v));
    row("Intención", r.intent ? r.intent.name : "ninguna");
    row("Confianza", pct(r.confidence));
    if (r.action) row("Acción", h("code", null, r.action));
    const params = Object.entries(r.parameters || {});
    row("Parámetros", params.length
      ? h("div", { class: "col", style: { gap: "2px" } }, params.map(([k, v]) => h("div", null, h("code", null, k), " = ", formatValue(v),
        r.parametersOriginal && r.parametersOriginal[k] != null && formatValue(r.parametersOriginal[k]) !== formatValue(v)
          ? h("span", { class: "faint" }, ` («${formatValue(r.parametersOriginal[k])}»)`) : null)))
      : h("span", { class: "faint" }, "ninguno"));
    if (!r.allRequiredParamsPresent) row("Estado", "Preguntando por un parámetro obligatorio");
    row("Contextos", r.outputContexts && r.outputContexts.length
      ? h("div", { class: "row wrap", style: { gap: "4px" } }, r.outputContexts.map((c) => h("span", { class: "badge primary", title: "Turnos restantes" }, `${c.name} · ${c.lifespan}`)))
      : h("span", { class: "faint" }, "ninguno"));
    if (r.webhook) row("Webhook", r.webhook.ok ? `OK (${r.webhook.ms} ms)` : h("span", { style: { color: "var(--danger)" } }, r.webhook.error || "error"));
    if (r.analysis) {
      row("Tokens", h("div", { class: "row wrap", style: { gap: "4px" } }, r.analysis.tokens.filter((t) => t.kind !== "symbol").map((t) =>
        h("code", { title: `raíz: ${t.stem}` }, t.corrected ? `${t.norm}→${t.corrected}` : t.norm))));
      if (r.analysis.entities.length) row("Entidades", h("div", { class: "col", style: { gap: "2px" } }, r.analysis.entities.map((e) =>
        h("div", null, h("code", null, e.entity), " ", `«${e.text}»`, " = ", formatValue(e.value)))));
      const alt = (r.analysis.ranking || []).slice(0, 3);
      if (alt.length) row("Candidatas", h("div", { class: "col", style: { gap: "2px" } }, alt.map((x) =>
        h("div", null, x.name, " ", h("span", { class: "faint" }, pct(x.confidence))))));
    }
    detail.append(kv);
    if (r.queryText) {
      detail.append(h("div", { class: "row" },
        h("button", { class: "btn sm", type: "button", onclick: () => {
          navigate(`#/a/${encodeURIComponent(getAgent().id)}/analyzer?q=${encodeURIComponent(r.queryText)}`);
        } }, icon("text"), "Ver análisis completo")));
    }
  }

  hint();
  return {
    el,
    reset,
    send,
    focus: () => setTimeout(() => input.focus(), 50),
    get sessionId() { return sessionId; },
    get state() { return state; },
  };
}
