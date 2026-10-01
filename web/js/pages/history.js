// Historial de conversaciones.
import { api } from "../api.js";
import { h, icon, clear, errorToast, timeAgo, fullDate, pct, formatValue } from "../ui.js";
import { agentPath, navigate, state } from "../app.js";

export async function render(el, [, sessionId]) {
  if (sessionId) return renderTranscript(el, sessionId);
  const page = h("div", { class: "page" });
  el.append(page);
  const [stats, convs] = await Promise.all([api.stats(state.agent.id), api.conversations(state.agent.id, { limit: 100 })]);
  const stat = (v, l) => h("div", { class: "card stat" }, h("div", { class: "v" }, String(v)), h("div", { class: "l" }, l));
  const fbRate = stats.messages ? Math.round((stats.fallbacks / stats.messages) * 100) + " %" : "—";
  page.append(
    h("div", { class: "page-head" }, h("div", { class: "grow" }, h("h1", null, "Historial"),
      h("div", { class: "sub" }, "Conversaciones de los últimos días (simulador, widget y API)."))),
    h("div", { class: "grid-3", style: { marginBottom: "14px" } },
      stat(stats.sessions, "conversaciones (30 días)"), stat(stats.messages, "mensajes"), stat(fbRate, "no entendidos")),
    stats.topIntents.length ? h("div", { class: "card", style: { marginBottom: "14px" } },
      h("div", { class: "card-head" }, h("h2", null, "Intenciones más usadas")),
      h("div", { class: "card-body col", style: { gap: "6px" } }, stats.topIntents.map((t) => {
        const max = stats.topIntents[0].count;
        return h("div", { class: "row" }, h("span", { style: { width: "180px" }, class: "nowrap" }, t.name),
          h("div", { class: "conf-bar grow" }, h("span", { style: { width: Math.round((t.count / max) * 100) + "%" } })),
          h("span", { class: "muted small", style: { width: "40px", textAlign: "right" } }, String(t.count)));
      }))) : null);
  const list = h("div", { class: "list" });
  if (!convs.items.length) list.append(h("div", { class: "empty" }, icon("history"), h("p", null, "Todavía no hay conversaciones.")));
  for (const c of convs.items) {
    const open = () => navigate(agentPath("history/" + encodeURIComponent(c.sessionId)));
    list.append(h("div", { class: "list-item", tabindex: "0", role: "link", onclick: open, onkeydown: (e) => { if (e.key === "Enter") open(); } },
      h("div", { class: "grow col", style: { gap: "2px" } },
        h("div", { class: "title", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, c.firstMessage ? "“" + c.firstMessage + "”" : "(evento)"),
        h("div", { class: "muted small" }, `${c.turns} turnos · ${c.source || "api"} · `, h("span", { title: fullDate(c.last) }, timeAgo(c.last)))),
      c.fallbacks ? h("span", { class: "badge warning" }, `${c.fallbacks} sin entender`) : null));
  }
  page.append(h("div", { class: "card" }, list));
  return null;
}

async function renderTranscript(el, sessionId) {
  const page = h("div", { class: "page" });
  el.append(page);
  let turns;
  try { turns = await api.conversation(state.agent.id, sessionId); } catch (e) { errorToast(e); turns = []; }
  const box = h("div", { class: "transcript" });
  for (const t of turns) {
    if (t.query || t.event) box.append(h("div", { class: "msg user", style: { maxWidth: "70%" } }, t.query || `⚡ ${t.event}`));
    if (t.response) box.append(h("div", { class: "msg bot", style: { maxWidth: "70%" } }, t.response));
    const params = Object.entries(t.parameters || {});
    box.append(h("div", { class: "turn-meta" },
      h("a", { href: t.intentId ? agentPath("intents/" + encodeURIComponent(t.intentId)) : "#" }, t.intentName || "—"),
      h("span", { class: "badge" + (t.isFallback ? " warning" : "") }, pct(t.confidence)),
      params.length ? h("span", { class: "faint" }, params.map(([k, v]) => `${k}=${formatValue(v)}`).join(" · ")) : null,
      h("span", { class: "faint", title: fullDate(t.ts) }, timeAgo(t.ts))));
  }
  if (!turns.length) box.append(h("div", { class: "empty" }, "Conversación vacía."));
  page.append(
    h("div", { class: "page-head" },
      h("a", { class: "btn ghost icon-only", href: agentPath("history"), "aria-label": "Volver" }, icon("back")),
      h("div", { class: "grow" }, h("h1", null, "Conversación"), h("div", { class: "sub mono" }, sessionId))),
    h("div", { class: "card" }, h("div", { class: "card-body" }, box)));
  return null;
}
