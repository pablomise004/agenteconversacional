// Historial de conversaciones.
import { api } from "../api.js";
import { h, icon, errorToast, timeAgo, fullDate, pct, formatValue, pageHead, emptyState, countUp, stagger } from "../ui.js";
import { barList, columnChart, format } from "../charts.js";
import { agentPath, navigate, setPageTitle, state } from "../app.js";

const int = (v) => format.nf(0).format(v);
const DAYS = 30;

// Mensajes de cada uno de los últimos 30 días (incluidos los días sin actividad)
function dailySeries(daily) {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const today = Math.floor((Date.now() / 1000 - new Date().getTimezoneOffset() * 60) / 86400);
  const out = [];
  for (let day = today - DAYS + 1; day <= today; day++) {
    const d = byDay.get(day) || { messages: 0, fallbacks: 0 };
    const date = new Date(day * 86400000);
    const short = date.toLocaleDateString("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });
    const long = date.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    out.push({ x: short, value: d.messages, title: `${int(d.messages)} ${d.messages === 1 ? "mensaje" : "mensajes"}`,
      tip: long + (d.fallbacks ? ` · ${int(d.fallbacks)} sin entender` : "") });
  }
  return out;
}

export async function render(el, [, sessionId]) {
  if (sessionId) return renderTranscript(el, sessionId);
  const page = h("div", { class: "page" });
  el.append(page);
  const [stats, convs] = await Promise.all([api.stats(state.agent.id, { days: DAYS }), api.conversations(state.agent.id, { limit: 100 })]);
  const tile = (ic, value, label, fmt, sub) => h("div", { class: "card stat" },
    h("span", { class: "s-icon" }, icon(ic)), h("div", { class: "l" }, label), countUp(h("div", { class: "v" }), value, fmt),
    h("div", { class: "faint small" }, sub));
  const fbRate = stats.messages ? stats.fallbacks / stats.messages : null;
  const pctOrDash = (v) => (v == null ? "—" : int(v * 100) + " %");
  const tiles = h("div", { class: "grid-4", style: { marginBottom: "16px" } },
    tile("message", stats.sessions, "Conversaciones", int, `últimos ${DAYS} días`),
    tile("chat", stats.messages, "Mensajes", int, stats.pendingReview ? `${int(stats.pendingReview)} por revisar` : "todo revisado"),
    tile("alert", fbRate, "No entendidos", pctOrDash,
      stats.fallbacks ? `${int(stats.fallbacks)} ${stats.fallbacks === 1 ? "mensaje" : "mensajes"}` : "ninguno"),
    tile("gauge", stats.messages ? stats.avgConfidence : null, "Confianza media", pctOrDash, "de las respuestas"));
  page.append(
    pageHead({ icon: "history", title: "Historial", sub: "Conversaciones de los últimos días (simulador, widget y API)." }),
    h("div", { class: "cq" }, tiles));
  stagger(tiles);
  if (stats.messages) {
    page.append(h("div", { class: "grid-2", style: { marginBottom: "16px", gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)" } },
      h("div", { class: "card", style: { margin: 0 } },
        h("div", { class: "card-head" }, icon("pulse"), h("h2", null, "Actividad"), h("span", { class: "help" }, `mensajes por día, últimos ${DAYS} días`)),
        h("div", { class: "card-body" }, columnChart({ data: dailySeries(stats.daily || []), label: "Mensajes por día" }))),
      h("div", { class: "card", style: { margin: 0 } },
        h("div", { class: "card-head" }, icon("target"), h("h2", null, "Intenciones más usadas")),
        h("div", { class: "card-body" }, barList({
          items: stats.topIntents.slice(0, 7).map((t) => ({ label: t.name, value: t.count, tip: "mensajes" })),
          format: (v) => int(v), labelWidth: 130 })))));
  }
  const list = h("div", { class: "list" });
  if (!convs.items.length) {
    list.append(emptyState({ icon: "history", title: "Todavía no hay conversaciones", text: "Habla con el bot en «Pruébalo» o desde el widget y aparecerán aquí." }));
  }
  for (const c of convs.items) {
    const open = () => navigate(agentPath("history/" + encodeURIComponent(c.sessionId)));
    list.append(h("div", { class: "list-item", tabindex: "0", role: "link", onclick: open, onkeydown: (e) => { if (e.key === "Enter") open(); } },
      h("span", { class: "li-icon" + (c.fallbacks ? " warning" : "") }, icon("message")),
      h("div", { class: "grow col", style: { gap: "2px" } },
        h("div", { class: "title ellipsis" }, c.firstMessage ? "“" + c.firstMessage + "”" : "(evento)"),
        h("div", { class: "muted small" }, `${c.turns} turnos · ${c.source || "api"} · `, h("span", { title: fullDate(c.last) }, timeAgo(c.last)))),
      c.fallbacks ? h("span", { class: "badge warning" }, `${c.fallbacks} sin entender`) : null,
      icon("chevRight", "chev")));
  }
  page.append(h("div", { class: "card" },
    h("div", { class: "card-head", style: { paddingBottom: "12px" } }, icon("list"), h("h2", null, "Conversaciones"), h("span", { class: "badge" }, String(convs.total))),
    list));
  stagger(list, 10);
  return null;
}

async function renderTranscript(el, sessionId) {
  const page = h("div", { class: "page" });
  el.append(page);
  setPageTitle("Conversación", state.agent.name);
  let turns;
  try { turns = await api.conversation(state.agent.id, sessionId); } catch (e) { errorToast(e); turns = []; }
  const box = h("div", { class: "transcript" });
  for (const t of turns) {
    if (t.query || t.event) box.append(h("div", { class: "msg user", style: { maxWidth: "70%" } }, t.query || `⚡ ${t.event}`));
    if (t.response) box.append(h("div", { class: "msg bot", style: { maxWidth: "70%" } }, t.response));
    const params = Object.entries(t.parameters || {});
    box.append(h("div", { class: "turn-meta" },
      t.intentId ? h("a", { class: "intent-link", href: agentPath("intents/" + encodeURIComponent(t.intentId)), style: { textDecoration: "none" } }, t.intentName || "—")
        : h("span", { class: "intent-link" }, t.intentName || "—"),
      h("span", { class: "badge" + (t.isFallback ? " warning" : t.confidence >= 0.8 ? " success" : "") }, pct(t.confidence)),
      params.length ? h("span", { class: "faint" }, params.map(([k, v]) => `${k}=${formatValue(v)}`).join(" · ")) : null,
      h("span", { class: "faint", title: fullDate(t.ts) }, timeAgo(t.ts))));
  }
  if (!turns.length) box.append(emptyState({ icon: "message", title: "Conversación vacía" }));
  page.append(
    pageHead({
      icon: "message", title: "Conversación",
      crumbs: [{ label: "Historial", href: agentPath("history") }, { label: turns.length ? fullDate(turns[0].ts) : "" }],
      sub: h("span", { class: "mono" }, sessionId),
    }),
    h("div", { class: "card" }, h("div", { class: "card-body sim-body", style: { borderRadius: "var(--radius)", padding: "20px" } }, box)));
  return null;
}
