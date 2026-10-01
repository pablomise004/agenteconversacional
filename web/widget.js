/*
 * Widget de chat del Agente conversacional.
 *
 * Uso: <script src="https://tu-servidor/widget.js" data-agent="pizzeria"></script>
 *
 * Atributos opcionales:
 *   data-title="Asistente"     data-color="#4361ee"     data-position="left"
 *   data-welcome="false"        (no lanzar el evento WELCOME al abrir)
 *   data-key="..."              (si el agente tiene clave de API)
 *   data-inline="#selector"     (mostrarlo dentro de un elemento, siempre abierto)
 *   data-placeholder="Escribe aquí…"   data-open="true" (abrir al cargar)
 *
 * API para la página:  window.AgenteChat.open() / close() / send("hola")
 * Los payloads personalizados se emiten como evento: window.addEventListener("agente:payload", e => e.detail)
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script) return;
  var cfg = script.dataset || {};
  var agent = cfg.agent;
  if (!agent) { console.error("[agente] Falta data-agent en la etiqueta <script>"); return; }
  var server = cfg.server || new URL(script.src, location.href).origin;
  var title = cfg.title || "Asistente";
  var color = /^#[0-9a-f]{3,8}$/i.test(cfg.color || "") ? cfg.color : "#4361ee";
  var welcome = cfg.welcome !== "false";
  var inlineSel = cfg.inline;
  var left = cfg.position === "left";
  var STORE = "agente.widget." + agent;
  var TTL = 20 * 60 * 1000;

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE) || "null"); } catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* sin almacenamiento */ }
  }
  function newSession() {
    return "web-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  var state = load();
  if (!state || !state.sessionId || Date.now() - (state.ts || 0) > TTL) {
    state = { sessionId: newSession(), ts: Date.now(), messages: [], ended: false };
  }

  var css = [
    ":host{all:initial}",
    "*{box-sizing:border-box;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif}",
    ".bubble{position:fixed;bottom:20px;" + (left ? "left" : "right") + ":20px;width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;",
    "background:var(--c);color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.25);display:grid;place-items:center;z-index:2147483000;transition:transform .15s}",
    ".bubble:hover{transform:scale(1.06)}.bubble svg{width:28px;height:28px}",
    ".panel{position:fixed;bottom:90px;" + (left ? "left" : "right") + ":20px;width:370px;height:min(580px,calc(100vh - 110px));background:#fff;color:#1b2232;",
    "border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.22);display:flex;flex-direction:column;overflow:hidden;z-index:2147483000;",
    "transform-origin:bottom " + (left ? "left" : "right") + ";animation:pop .16s ease}",
    ".panel.inline{position:relative;inset:auto;width:100%;height:100%;border-radius:0;box-shadow:none;animation:none}",
    "@keyframes pop{from{opacity:0;transform:scale(.92)}}",
    ".hidden{display:none!important}",
    ".head{background:var(--c);color:#fff;padding:14px 14px 14px 18px;display:flex;align-items:center;gap:8px}",
    ".head b{flex:1;font-size:16px}.head button{background:transparent;border:0;color:#fff;cursor:pointer;opacity:.85;padding:4px;border-radius:6px;display:grid;place-items:center}",
    ".head button:hover{opacity:1;background:rgba(255,255,255,.15)}.head svg{width:18px;height:18px}",
    ".body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#f5f6fa}",
    ".msg{max-width:85%;padding:9px 13px;border-radius:16px;line-height:1.45;font-size:14.5px;white-space:pre-wrap;word-break:break-word}",
    ".bot{align-self:flex-start;background:#fff;border:1px solid #e3e6ee;border-bottom-left-radius:5px}",
    ".user{align-self:flex-end;background:var(--c);color:#fff;border-bottom-right-radius:5px}",
    ".bot a{color:var(--c)}.user a{color:#fff}",
    ".note{align-self:center;color:#8a94a8;font-size:12px}",
    ".quick{display:flex;flex-wrap:wrap;gap:6px}",
    ".quick button{border:1px solid var(--c);color:var(--c);background:#fff;border-radius:18px;padding:6px 13px;font-size:13.5px;cursor:pointer}",
    ".quick button:hover{background:var(--c);color:#fff}",
    ".typing{align-self:flex-start;display:flex;gap:4px;padding:12px 14px;background:#fff;border:1px solid #e3e6ee;border-radius:16px}",
    ".typing i{width:7px;height:7px;border-radius:50%;background:#aab2c3;animation:b 1s infinite}",
    ".typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}",
    "@keyframes b{0%,60%,100%{transform:none;opacity:.6}30%{transform:translateY(-4px);opacity:1}}",
    "form{display:flex;gap:8px;padding:10px;border-top:1px solid #e3e6ee;background:#fff}",
    "input{flex:1;border:1px solid #cfd5e1;border-radius:22px;padding:10px 14px;font-size:14.5px;outline:none;color:#1b2232;background:#fff}",
    "input:focus{border-color:var(--c)}",
    "form button{width:42px;height:42px;border-radius:50%;border:0;background:var(--c);color:#fff;cursor:pointer;display:grid;place-items:center}",
    "form button:disabled{opacity:.5}form button svg{width:18px;height:18px}",
    ".brand{text-align:center;font-size:11px;color:#a0a8b8;padding:0 0 6px;background:#fff}",
    "@media (max-width:480px){.panel:not(.inline){inset:0;width:100%;height:100%;border-radius:0;bottom:0}}",
  ].join("");

  var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg>';
  var ICON_RESET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/></svg>';

  var host = document.createElement("div");
  host.setAttribute("data-agente-widget", agent);
  var container = inlineSel ? document.querySelector(inlineSel) : null;
  (container || document.body).appendChild(host);
  if (container) host.style.cssText = "display:block;width:100%;height:100%";
  var root = host.attachShadow({ mode: "open" });
  root.innerHTML = '<style>' + css + '</style>' +
    '<button class="bubble" type="button" aria-label="Abrir chat">' + ICON_CHAT + '</button>' +
    '<div class="panel hidden" role="dialog" aria-label="Chat">' +
    '<div class="head"><b></b><button class="reset" type="button" title="Nueva conversación" aria-label="Nueva conversación">' + ICON_RESET + '</button>' +
    '<button class="close" type="button" aria-label="Cerrar">' + ICON_X + '</button></div>' +
    '<div class="body" aria-live="polite"></div>' +
    '<form><input type="text" maxlength="1000" autocomplete="off" aria-label="Mensaje"><button type="submit" aria-label="Enviar">' + ICON_SEND + '</button></form>' +
    '</div>';
  root.host.style.setProperty("--c", color);
  var bubble = root.querySelector(".bubble");
  var panel = root.querySelector(".panel");
  var body = root.querySelector(".body");
  var form = root.querySelector("form");
  var input = root.querySelector("input");
  var sendBtn = root.querySelector("form button");
  root.querySelector(".head b").textContent = title;
  input.placeholder = cfg.placeholder || "Escribe un mensaje…";
  if (container) {
    bubble.classList.add("hidden");
    panel.classList.add("inline");
    root.querySelector(".close").classList.add("hidden");
  }

  var busy = false;
  var opened = false;

  function linkify(el, text) {
    var re = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)])/g;
    var last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = document.createElement("a");
      a.href = m[1];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = m[1];
      el.appendChild(a);
      last = m.index + m[1].length;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
  }

  function scroll() { body.scrollTop = body.scrollHeight; }

  function addMessage(m, remember) {
    var el;
    if (m.type === "user" || m.type === "bot" || m.type === "note") {
      el = document.createElement("div");
      el.className = m.type === "note" ? "note" : "msg " + m.type;
      linkify(el, m.text);
    } else if (m.type === "quick") {
      el = document.createElement("div");
      el.className = "quick";
      m.items.forEach(function (q) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = q;
        b.addEventListener("click", function () { send(q); });
        el.appendChild(b);
      });
    }
    if (el) body.appendChild(el);
    if (remember) {
      state.messages.push(m);
      if (state.messages.length > 60) state.messages = state.messages.slice(-60);
      state.ts = Date.now();
      save();
    }
    scroll();
  }

  function clearQuick() {
    var qs = body.querySelectorAll(".quick");
    for (var i = 0; i < qs.length; i++) qs[i].remove();
    state.messages = state.messages.filter(function (m) { return m.type !== "quick"; });
  }

  function request(payload) {
    var headers = { "Content-Type": "application/json" };
    if (cfg.key) headers["X-Api-Key"] = cfg.key;
    payload.sessionId = state.sessionId;
    payload.source = "widget";
    return fetch(server + "/api/agents/" + encodeURIComponent(agent) + "/detect", {
      method: "POST", headers: headers, body: JSON.stringify(payload),
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data && data.detail ? data.detail : "Error " + r.status);
        return data;
      });
    });
  }

  function send(text, event) {
    text = (text || "").trim();
    if (busy || (!text && !event)) return;
    if (state.ended) {
      state = { sessionId: newSession(), ts: Date.now(), messages: state.messages, ended: false };
    }
    clearQuick();
    if (text) addMessage({ type: "user", text: text }, true);
    input.value = "";
    busy = true;
    sendBtn.disabled = true;
    var typing = document.createElement("div");
    typing.className = "typing";
    typing.innerHTML = "<i></i><i></i><i></i>";
    body.appendChild(typing);
    scroll();
    request(text ? { text: text } : { event: event })
      .then(function (r) {
        typing.remove();
        (r.messages || []).forEach(function (m) {
          if (m.type === "text") addMessage({ type: "bot", text: m.text }, true);
          else if (m.type === "quickReplies" && m.items.length) addMessage({ type: "quick", items: m.items }, true);
          else if (m.type === "payload") {
            try { window.dispatchEvent(new CustomEvent("agente:payload", { detail: m.payload })); } catch (e) { /* nada */ }
          }
        });
        if (r.endConversation) state.ended = true;
        state.ts = Date.now();
        save();
      })
      .catch(function (e) {
        typing.remove();
        addMessage({ type: "note", text: "No se pudo enviar el mensaje (" + e.message + ")." }, false);
      })
      .then(function () {
        busy = false;
        sendBtn.disabled = false;
        if (opened) input.focus();
      });
  }

  function open() {
    panel.classList.remove("hidden");
    if (!container) bubble.innerHTML = ICON_X;
    opened = true;
    if (!state.messages.length && welcome) send(null, "WELCOME");
    setTimeout(function () { input.focus(); scroll(); }, 30);
  }

  function close() {
    if (container) return;
    panel.classList.add("hidden");
    bubble.innerHTML = ICON_CHAT;
    opened = false;
  }

  function reset() {
    state = { sessionId: newSession(), ts: Date.now(), messages: [], ended: false };
    save();
    while (body.firstChild) body.firstChild.remove();
    if (welcome) send(null, "WELCOME");
  }

  state.messages.forEach(function (m) { addMessage(m, false); });
  bubble.addEventListener("click", function () { if (opened) close(); else open(); });
  root.querySelector(".close").addEventListener("click", close);
  root.querySelector(".reset").addEventListener("click", reset);
  form.addEventListener("submit", function (e) { e.preventDefault(); send(input.value); });
  panel.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

  window.AgenteChat = { open: open, close: close, send: function (t) { open(); send(t); }, reset: reset };
  if (container || cfg.open === "true") open();
})();
