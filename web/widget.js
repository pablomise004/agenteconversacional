/*
 * Widget de chat de Lince.
 *
 * Uso: <script src="https://tu-servidor/widget.js" data-agent="pizzeria"></script>
 *
 * Atributos opcionales:
 *   data-title="Asistente"     data-color="#4f46e5"     data-position="left"
 *   data-theme="auto"           (light, por defecto; dark; o auto = como el sistema del visitante)
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
  var color = /^#[0-9a-f]{3,8}$/i.test(cfg.color || "") ? cfg.color : "#4f46e5";
  var theme = /^(dark|auto)$/.test(cfg.theme || "") ? cfg.theme : "light";
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

  var side = left ? "left" : "right";
  // Colores del panel en variables: claro por defecto, oscuro con data-theme="dark" y
  // data-theme="auto" sigue el modo del sistema del visitante. --ink es el color de marca
  // para textos y bordes: en oscuro se aclara para que se lea sobre el fondo.
  var DARK = "color-scheme:dark;--bg:#1c1c1c;--fg:#ececec;--soft:#141414;--card:#262626;--line:#303030;--line2:#424242;" +
    "--muted:#9b9b9b;--dot:#8a8a8a;--edge:rgba(255,255,255,.08);--ring:rgba(255,255,255,.1);--ink:color-mix(in srgb,var(--c) 50%,#fff)";
  var css = [
    ":host{all:initial;--bg:#fff;--fg:#1b2232;--soft:#f6f7f9;--card:#fff;--line:#e7e8eb;--line2:#d6d8dd;--muted:#666b77;",
    "--dot:#a1a6b0;--edge:rgba(0,0,0,.04);--ring:rgba(0,0,0,.06);--ink:var(--c);--tint:var(--card);--tline:var(--line2);--glow:transparent}",
    "@supports (color:color-mix(in srgb,red,blue)){:host{--tint:color-mix(in srgb,var(--c) 9%,var(--card));",
    "--tline:color-mix(in srgb,var(--c) 30%,transparent);--glow:color-mix(in srgb,var(--c) 14%,transparent)}}",
    ":host([data-agente-theme=dark]){" + DARK + "}",
    "@media (prefers-color-scheme:dark){:host([data-agente-theme=auto]){" + DARK + "}}",
    "*{box-sizing:border-box;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif}",
    // burbuja
    ".bubble{position:fixed;bottom:20px;" + side + ":20px;width:60px;height:60px;border-radius:18px;border:0;cursor:pointer;",
    "background:var(--c);color:#fff;box-shadow:0 10px 26px -6px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.25);display:grid;",
    "place-items:center;z-index:2147483000;transition:transform .25s cubic-bezier(.34,1.45,.64,1),box-shadow .2s}",
    ".bubble:hover{transform:translateY(-2px) scale(1.05);box-shadow:0 14px 30px -6px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.25)}",
    ".bubble:active{transform:scale(.96)}",
    ".bubble svg{width:27px;height:27px;grid-area:1/1;transition:transform .3s cubic-bezier(.34,1.45,.64,1),opacity .2s}",
    ".bubble .i-x{opacity:0;transform:rotate(-90deg) scale(.6)}",
    ".bubble.open .i-chat{opacity:0;transform:rotate(90deg) scale(.6)}.bubble.open .i-x{opacity:1;transform:none}",
    ".bubble::after{content:'';position:absolute;inset:0;border-radius:18px;border:2px solid var(--c);opacity:0;animation:ping 2.4s ease-out 1.2s 2}",
    "@keyframes ping{0%{transform:scale(1);opacity:.6}80%,100%{transform:scale(1.6);opacity:0}}",
    // panel
    ".panel{position:fixed;bottom:94px;" + side + ":20px;width:380px;height:min(600px,calc(100vh - 116px));background:var(--bg);color:var(--fg);",
    "border-radius:20px;box-shadow:0 24px 60px -12px rgba(0,0,0,.35),0 0 0 1px var(--edge);display:flex;flex-direction:column;",
    "overflow:hidden;z-index:2147483000;transform-origin:bottom " + side + ";animation:pop .32s cubic-bezier(.34,1.45,.64,1)}",
    ".panel.closing{animation:out .18s ease forwards}",
    ".panel.inline{position:relative;inset:auto;width:100%;height:100%;border-radius:0;box-shadow:none;animation:none}",
    "@keyframes pop{from{opacity:0;transform:translateY(12px) scale(.94)}}",
    "@keyframes out{to{opacity:0;transform:translateY(8px) scale(.96)}}",
    ".hidden{display:none!important}",
    ".head{background:var(--c);color:#fff;padding:14px 12px 14px 16px;display:flex;align-items:center;gap:10px;",
    "background-image:linear-gradient(135deg,rgba(255,255,255,.16),rgba(0,0,0,.08))}",
    ".avatar{width:36px;height:36px;border-radius:12px;background:rgba(255,255,255,.2);display:grid;place-items:center;",
    "font-weight:700;font-size:15px;flex:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.25)}",
    ".who{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.25}",
    ".who b{font-size:15.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".who span{font-size:12px;opacity:.85;display:flex;align-items:center;gap:5px}",
    ".who span::before{content:'';width:7px;height:7px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 2px rgba(255,255,255,.3)}",
    ".head button{background:transparent;border:0;color:#fff;cursor:pointer;opacity:.85;padding:6px;border-radius:9px;display:grid;",
    "place-items:center;transition:background-color .15s,opacity .15s,transform .3s}",
    ".head button:hover{opacity:1;background:rgba(255,255,255,.16)}.head .reset:hover{transform:rotate(-90deg)}.head svg{width:18px;height:18px}",
    ".body{flex:1;overflow-y:auto;padding:16px 14px;display:flex;flex-direction:column;gap:8px;background:var(--soft);scroll-behavior:smooth;",
    "background-image:radial-gradient(420px 180px at 50% -50px,var(--glow),transparent 70%)}",
    // los navegadores dejan llegar con el tabulador a lo que tiene scroll (para moverlo con las flechas)
    ".body:focus-visible{outline:2px solid var(--c);outline-offset:-2px}",
    ".msg{max-width:85%;padding:9px 13px;border-radius:14px;line-height:1.45;font-size:14.5px;white-space:pre-wrap;word-break:break-word;",
    "animation:msg .3s cubic-bezier(.34,1.45,.64,1) backwards}",
    "@keyframes msg{from{opacity:0;transform:translateY(8px) scale(.96)}}",
    ".bot{position:relative;margin-left:36px;align-self:flex-start;background:var(--card);border:1px solid var(--line);",
    "box-shadow:0 1px 2px rgba(16,18,27,.05);transform-origin:top left}",
    ".bot:not(.bot+.bot),.typing{border-top-left-radius:4px}",
    ".bot:not(.bot+.bot)::before,.typing::before{content:var(--ini,'');position:absolute;left:-37px;top:-1px;width:28px;height:28px;",
    "border-radius:9px;display:grid;place-items:center;font-size:12.5px;font-weight:700;color:#fff;background:var(--c);",
    "background-image:linear-gradient(135deg,rgba(255,255,255,.25),rgba(0,0,0,.08));box-shadow:0 4px 10px -4px var(--c)}",
    ".user{align-self:flex-end;background:var(--c);color:#fff;border-bottom-right-radius:4px;transform-origin:bottom right;",
    "background-image:linear-gradient(135deg,rgba(255,255,255,.2),rgba(255,255,255,0) 60%);box-shadow:0 8px 18px -10px var(--c)}",
    ".bot a{color:var(--ink)}.user a{color:#fff}",
    // avisos: una línea fina con el texto en medio
    ".note{align-self:stretch;display:flex;align-items:center;gap:10px;color:var(--muted);font-size:12px;text-align:center}",
    ".note::before,.note::after{content:'';flex:1 1 24px;height:1px;background:var(--line)}",
    ".quick{display:flex;flex-wrap:wrap;gap:6px;margin-left:36px;animation:msg .3s cubic-bezier(.34,1.45,.64,1) .1s backwards}",
    ".quick button{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--tline);color:var(--ink);background:var(--tint);",
    "border-radius:10px;padding:7px 10px 7px 12px;font-size:13.5px;font-weight:600;cursor:pointer;",
    "transition:background-color .15s,color .15s,border-color .15s,box-shadow .2s,transform .2s}",
    // la flecha se forma al pasar el ratón: en reposo, un cheurón fino; luego avanza y le sale el trazo
    ".quick button .go{width:14px;height:14px;margin-right:-3px;opacity:.6;transition:opacity .15s}",
    ".go .tip{transform:translateX(-3px);transition:transform .28s cubic-bezier(.34,1.45,.64,1)}",
    ".go .line{opacity:0;transform:scaleX(0);transform-box:fill-box;transform-origin:left center;",
    "transition:opacity .15s,transform .28s cubic-bezier(.34,1.45,.64,1)}",
    ".quick button:hover{background:var(--c);border-color:var(--c);color:#fff;transform:translateY(-1px);box-shadow:0 8px 16px -8px var(--c)}",
    ".quick button:hover .go{opacity:1}.quick button:hover .go .tip,.quick button:hover .go .line{opacity:1;transform:none}",
    ".typing{position:relative;margin-left:36px;align-self:flex-start;display:flex;gap:4px;padding:12px 14px;background:var(--card);",
    "border:1px solid var(--line);border-radius:14px;animation:msg .2s ease}",
    ".typing i{width:7px;height:7px;border-radius:50%;background:var(--c);animation:b 1s infinite}",
    ".typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}",
    "@keyframes b{0%,60%,100%{transform:none;opacity:.5}30%{transform:translateY(-4px);opacity:1}}",
    // caja de escribir con el botón de enviar dentro
    "form{padding:10px 12px 12px;border-top:1px solid var(--line);background:var(--bg)}",
    ".box{display:flex;align-items:center;gap:6px;padding:4px;border:1px solid var(--line2);border-radius:14px;background:var(--card);",
    "transition:border-color .15s,box-shadow .15s}",
    ".box:focus-within{border-color:var(--c);box-shadow:0 0 0 4px var(--ring),0 10px 22px -14px var(--c)}",
    "input{flex:1;min-width:0;border:0;padding:9px 10px;font-size:14.5px;outline:none;color:var(--fg);background:transparent}",
    "input::placeholder{color:var(--muted)}",
    "form button{width:38px;height:38px;border-radius:11px;border:0;background:var(--c);color:#fff;cursor:pointer;display:grid;",
    "background-image:linear-gradient(135deg,rgba(255,255,255,.22),rgba(0,0,0,.06));box-shadow:0 6px 14px -6px var(--c);",
    "place-items:center;flex:none;transition:transform .2s cubic-bezier(.34,1.45,.64,1),opacity .15s}",
    "form button:hover:not(:disabled){transform:translateY(-1px)}form button:active:not(:disabled){transform:scale(.94)}",
    "form button:disabled{opacity:.5;cursor:default}form button svg{width:19px;height:19px}",
    "form button .plane{transition:transform .3s cubic-bezier(.34,1.45,.64,1)}",
    "form button:hover:not(:disabled) .plane{transform:translate(1.5px,-1.5px)}",
    "@media (max-width:480px){.panel:not(.inline){inset:0;width:100%;height:100%;border-radius:0;bottom:0}}",
    "@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}",
  ].join("");

  var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  // enviar: un avión de papel en dos tonos, el mismo que en la consola
  var ICON_SEND = '<svg viewBox="0 0 24 24"><g class="plane">' +
    '<path d="M20.4 3.2 3.6 9.9c-.9.4-.9 1.6 0 2l6.2 2.4 2.4 6.2c.4.9 1.6.9 2 0z" fill="currentColor" opacity=".55" stroke="currentColor" stroke-opacity=".55" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<path d="M20.4 3.2 9.8 14.3l-6.2-2.4c-.9-.4-.9-1.6 0-2z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></g></svg>';
  var ICON_GO = '<svg class="go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"><path class="line" d="M4.5 12h11"/><path class="tip" d="M10.5 6.5 16 12l-5.5 5.5"/></svg>';
  var ICON_RESET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/></svg>';

  var host = document.createElement("div");
  host.setAttribute("data-agente-widget", agent);
  host.setAttribute("data-agente-theme", theme);  // con prefijo: no choca con el CSS de la web
  var container = inlineSel ? document.querySelector(inlineSel) : null;
  (container || document.body).appendChild(host);
  if (container) host.style.cssText = "display:block;width:100%;height:100%";
  var root = host.attachShadow({ mode: "open" });
  // marcado constante; el título se pone después como texto
  root.innerHTML = '<style>' + css + '</style>' +
    '<button class="bubble" type="button" aria-label="Abrir chat">' +
    ICON_CHAT.replace("<svg ", '<svg class="i-chat" ') + ICON_X.replace("<svg ", '<svg class="i-x" ') + '</button>' +
    '<div class="panel hidden" role="dialog" aria-label="Chat">' +
    '<div class="head"><span class="avatar"></span><span class="who"><b></b><span>En línea</span></span>' +
    '<button class="reset" type="button" title="Nueva conversación" aria-label="Nueva conversación">' + ICON_RESET + '</button>' +
    '<button class="close" type="button" aria-label="Cerrar">' + ICON_X + '</button></div>' +
    '<div class="body" aria-live="polite"></div>' +
    '<form><div class="box"><input type="text" name="mensaje" maxlength="1000" autocomplete="off" aria-label="Mensaje">' +
    '<button type="submit" aria-label="Enviar">' + ICON_SEND + '</button></div></form>' +
    '</div>';
  root.host.style.setProperty("--c", color);
  var bubble = root.querySelector(".bubble");
  var panel = root.querySelector(".panel");
  var body = root.querySelector(".body");
  var form = root.querySelector("form");
  var input = root.querySelector("input");
  var sendBtn = root.querySelector("form button");
  root.querySelector(".who b").textContent = title;
  var initial = (title.trim()[0] || "?").toUpperCase();
  root.querySelector(".avatar").textContent = initial;
  root.host.style.setProperty("--ini", JSON.stringify(initial));  // el avatar junto a los mensajes
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
        b.insertAdjacentHTML("beforeend", ICON_GO);  // marcado constante
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
    clearTimeout(closing);
    panel.classList.remove("hidden", "closing");
    if (!container) {
      bubble.classList.add("open");
      bubble.setAttribute("aria-label", "Cerrar chat");
    }
    opened = true;
    if (!state.messages.length && welcome) send(null, "WELCOME");
    setTimeout(function () { input.focus(); scroll(); }, 30);
  }

  var closing = 0;
  function close() {
    if (container) return;
    panel.classList.add("closing");
    closing = setTimeout(function () { panel.classList.add("hidden"); panel.classList.remove("closing"); }, 180);
    bubble.classList.remove("open");
    bubble.setAttribute("aria-label", "Abrir chat");
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
