// Utilidades de interfaz. Todo el texto se inserta como nodos de texto (nunca
// como HTML), así que el contenido de los usuarios no puede inyectar código.

const SVGNS = "http://www.w3.org/2000/svg";

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") {
      for (const [sk, sv] of Object.entries(v)) {
        if (sv == null) continue;
        if (sk.startsWith("--")) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    } else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "value" || k === "checked" || k === "disabled" || k === "selected" || k === "indeterminate") el[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of [children].flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ------------------------------------------------------------------- iconos
const ICONS = {
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.4"/>',
  text: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
  training: '<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="M22 4L12 14l-3-3"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  plug: '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  scale: '<path d="M12 4v16M8 20h8M3.5 7h17"/><circle cx="12" cy="4" r="1"/>' +
    '<path d="M5 7l-2.6 6.2c.6 1.1 1.5 1.6 2.6 1.6s2-.5 2.6-1.6zM19 7l-2.6 6.2c.6 1.1 1.5 1.6 2.6 1.6s2-.5 2.6-1.6z"/>',
  // flecha que se forma al pasar el ratón (respuestas rápidas): en reposo, solo el cheurón
  go: '<path class="go-line" d="M4.5 12h11"/><path class="go-tip" d="M10.5 6.5 16 12l-5.5 5.5"/>',
  // enviar: un avión de papel en dos tonos (la parte de abajo, plegada), con las esquinas suaves;
  // al pasar el ratón despega un poco (app.css)
  send: '<g class="send-plane"><path d="M20.4 3.2 3.6 9.9c-.9.4-.9 1.6 0 2l6.2 2.4 2.4 6.2c.4.9 1.6.9 2 0z" fill="currentColor" opacity=".55" stroke="currentColor" stroke-opacity=".55" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<path d="M20.4 3.2 9.8 14.3l-6.2-2.4c-.9-.4-.9-1.6 0-2z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></g>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13v1M15 13v1"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  i: '<path d="M12 17v-6M12 7h.01"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>',
  zap: '<path d="M13 2L3 14h9l-1 8 10-12h-9z"/>',
  layers: '<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  thumbUp: '<path d="M7 10v11M2 12v7a2 2 0 0 0 2 2h12.3a2 2 0 0 0 2-1.7l1.4-8A2 2 0 0 0 17.7 9H14V5a3 3 0 0 0-3-3l-4 8"/>',
  thumbDown: '<path d="M17 14V3M22 12V5a2 2 0 0 0-2-2H7.7a2 2 0 0 0-2 1.7l-1.4 8A2 2 0 0 0 6.3 15H10v4a3 3 0 0 0 3 3l4-8"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M17 6l3 3M14 9l2 2"/>',
  pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  book: '<path d="M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  chevRight: '<path d="M9 6l6 6-6 6"/>',
  chevUpDown: '<path d="M8 9l4-4 4 4M8 15l4 4 4-4"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  enter: '<path d="M9 10l-5 5 5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  code: '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
  braces: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  gauge: '<path d="M12 14l4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  terminal: '<path d="M4 17l6-5-6-5M12 19h8"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  message: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M10 13h4M7 16h10"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
};

export function icon(name, cls = "") {
  const el = document.createElementNS(SVGNS, "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("class", "icon " + cls);
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = ICONS[name] || "";
  return el;
}

// Logotipo (el mismo dibujo que web/favicon.svg). Marcado constante, sin datos de usuario.
const LOGO = '<defs><linearGradient id="{id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b5cf6"/>' +
  '<stop offset="1" stop-color="#9645ee"/></linearGradient><radialGradient id="{id}b" cx=".2" cy="0" r="1">' +
  '<stop offset="0" stop-color="#fff" stop-opacity=".24"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>' +
  '<rect width="32" height="32" rx="9" fill="url(#{id}a)"/><rect width="32" height="32" rx="9" fill="url(#{id}b)"/>' +
  '<path fill="#fff" d="M16 9.74C18.56 9.74 21.04 10.59 22.65 12.4C23.89 13.82 24.45 15.63 24.65 17.34Q25.4 19.62 27.3 20.95' +
  'Q25.69 21.23 24.55 21.23Q24.93 23.14 25.88 24.94Q23.89 24.65 22.08 25.13C20.37 25.6 18.38 26.65 16 26.65' +
  'C13.62 26.65 11.63 25.6 9.92 25.13Q8.11 24.65 6.12 24.94Q7.07 23.14 7.45 21.23Q6.31 21.23 4.7 20.95' +
  'Q6.6 19.62 7.35 17.34C7.55 15.63 8.11 13.82 9.35 12.4C10.96 10.59 13.44 9.74 16 9.74Z"/>' +
  '<path fill="#fff" d="M17.23 10.5C18.95 8.31 20.46 6.42 22.08 4.71C23.5 7.27 24.07 10.59 23.5 14.59Z' +
  'M14.77 10.5C13.05 8.31 11.54 6.42 9.92 4.71C8.5 7.27 7.93 10.59 8.5 14.59Z"/>' +
  '<path fill="#d9d3fe" d="M18.85 10.88C19.9 9.55 20.75 8.5 21.8 7.46C22.55 8.98 22.75 10.79 22.46 12.49Z' +
  'M13.15 10.88C12.1 9.55 11.25 8.5 10.2 7.46C9.45 8.98 9.25 10.79 9.54 12.49Z"/>' +
  '<path fill="#2a1f6e" d="M21.41 5.43Q21.65 3.57 22.46 1.81Q22.84 3.66 22.59 5.74Q22 6.02 21.41 5.43Z' +
  'M10.59 5.43Q10.35 3.57 9.54 1.81Q9.16 3.66 9.41 5.74Q10 6.02 10.59 5.43Z' +
  'M17.85 16.79C18.83 14.57 20.87 14.65 21.75 16.56C20.77 18.61 18.83 18.78 17.85 16.79Z' +
  'M14.15 16.79C13.17 14.57 11.13 14.65 10.25 16.56C11.23 18.61 13.17 18.78 14.15 16.79Z' +
  'M14.57 19.9H17.43C17.9 19.9 18 20.38 17.14 20.76L16.43 21.28C16.19 21.52 15.81 21.52 15.57 21.28L14.86 20.76' +
  'C14.01 20.38 14.1 19.9 14.57 19.9Z"/>' +
  '<circle cx="19.09" cy="15.99" r=".55" fill="#fff"/><circle cx="11.49" cy="15.99" r=".55" fill="#fff"/>' +
  '<path fill="none" stroke="#2a1f6e" stroke-width=".65" stroke-linecap="round" d="M16 21.28v.67q-.19.61-1.33.57M16 21.95q.19.61 1.33.57"/>';
let logoSeq = 0;
export function logo(cls = "logo") {
  const el = document.createElementNS(SVGNS, "svg");
  el.setAttribute("viewBox", "0 0 32 32");
  el.setAttribute("class", cls);
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = LOGO.replaceAll("{id}", "lince" + ++logoSeq);
  return el;
}

// Avatar con iniciales y un degradado estable para cada nombre
const AVATAR_COLORS = [["#5b5cf6", "#9645ee"], ["#0ea5e9", "#6366f1"], ["#10b981", "#0ea5e9"], ["#f59e0b", "#ef4444"],
  ["#ec4899", "#8b5cf6"], ["#14b8a6", "#22c55e"], ["#f97316", "#e11d48"], ["#6366f1", "#06b6d4"]];
export function avatar(name, cls = "") {
  const words = String(name || "?").replace(/[()«»"']/g, " ").trim().split(/\s+/).filter((w, i) => i === 0 || w.length > 2);
  const first = words[0] || "?";
  const initials = (first[0] + (words[1] ? words[1][0] : first[1] || "")).toUpperCase();
  let hsh = 0;
  for (const c of String(name || "")) hsh = (hsh * 31 + c.charCodeAt(0)) >>> 0;
  const [a, b] = AVATAR_COLORS[hsh % AVATAR_COLORS.length];
  return h("span", { class: "avatar " + cls, style: { "--av1": a, "--av2": b }, "aria-hidden": "true" }, initials);
}

// ------------------------------------------------------------------ toasts
let toastBox;
const TOAST_ICON = { success: "check", error: "x", info: "i" };
export function toast(message, type = "info", ms = 2600) {
  if (!toastBox) {
    toastBox = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
    document.body.append(toastBox);
  }
  const leave = () => {
    if (t.classList.contains("leaving")) return;
    t.classList.add("leaving");
    setTimeout(() => t.remove(), 220);
  };
  const t = h("div", { class: "toast " + type },
    h("span", { class: "t-icon" }, icon(TOAST_ICON[type] || "i")),
    h("span", null, message),
    h("button", { class: "t-close", type: "button", "aria-label": "Cerrar el aviso", onclick: leave }, icon("x")));
  toastBox.append(t);
  while (toastBox.children.length > 4) toastBox.firstChild.remove();
  setTimeout(leave, type === "error" ? Math.max(ms, 5000) : ms);
}

export function errorToast(err) {
  toast(err && err.message ? err.message : String(err), "error");
}

// ------------------------------------------------------------------ modales
const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

// closable: false → sin aspa ni Escape (la de entrar en un servidor con cuentas es obligatoria)
export function modal({ title, body, actions = [], wide = false, onOpen, closable = true }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    let closed = false;
    const close = (value) => {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey, true);
      // animación de salida: la caja deja de llamarse .modal para no confundirse con la siguiente
      back.classList.add("leaving");
      box.classList.replace("modal", "modal-leaving");
      box.setAttribute("inert", "");
      setTimeout(() => back.remove(), 170);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(value);
    };
    const onKey = (e) => {
      // con un desplegable abierto dentro (popover o selectMenu), Escape cierra solo el desplegable
      if (e.key === "Escape") { if (openPopover || openMenu) return; e.stopPropagation(); if (closable) close(null); return; }
      if (e.key === "Tab") { // el foco no sale de la ventana
        const items = [...box.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    const foot = h("div", { class: "modal-foot" },
      actions.map((a) => h("button", {
        class: "btn" + (a.primary ? " primary" : "") + (a.danger ? " danger" : ""),
        type: "button",
        onclick: async () => {
          if (a.validate) {
            const ok = await a.validate();
            if (!ok) return;
          }
          close(typeof a.value === "function" ? a.value() : a.value);
        },
      }, a.label)));
    const box = h("div", { class: "modal" + (wide ? " wide" : ""), role: "dialog", "aria-modal": "true", "aria-label": title },
      h("div", { class: "modal-head" }, h("h3", null, title), h("div", { class: "spacer" }),
        closable ? h("button", { class: "btn ghost sm icon-only", type: "button", "aria-label": "Cerrar", onclick: () => close(null) }, icon("x")) : null),
      h("div", { class: "modal-body" }, body),
      actions.length ? foot : null);
    const back = h("div", { class: "modal-back", onmousedown: (e) => { if (e.target === back && closable) close(null); } }, box);
    document.body.append(back);
    document.addEventListener("keydown", onKey, true);
    const first = box.querySelector("input, textarea, select");
    (first || box.querySelector(".btn.primary") || box).focus();
    if (onOpen) onOpen(box, close);
  });
}

export function confirmDialog(message, { title = "¿Seguro?", okLabel = "Aceptar", danger = false } = {}) {
  return modal({
    title,
    body: h("p", { style: { margin: 0, color: "var(--muted)" } }, message),
    actions: [{ label: "Cancelar", value: false }, { label: okLabel, primary: !danger, danger, value: true }],
  }).then((v) => !!v);
}

export function promptDialog(title, { label = "", value = "", placeholder = "", okLabel = "Aceptar", hint = "" } = {}) {
  const input = h("input", { type: "text", value, placeholder });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); input.closest(".modal").querySelector(".btn.primary").click(); }
  });
  return modal({
    title,
    body: h("label", { class: "field" }, label, input, hint ? h("span", { class: "hint" }, hint) : null),
    actions: [{ label: "Cancelar", value: null }, { label: okLabel, primary: true, value: () => input.value.trim() }],
  });
}

// ------------------------------------------------------------- chips input
export function chipsInput({ values = [], placeholder = "Escribe y pulsa Enter", onChange, transform, list } = {}) {
  let items = [...values];
  const input = h("input", { type: "text", placeholder, "aria-label": placeholder });
  let datalist = null;
  if (list) {
    const id = "dl-" + Math.random().toString(36).slice(2);
    input.setAttribute("list", id);
    datalist = h("datalist", { id }, list.map((v) => h("option", { value: v })));
  }
  const box = h("div", { class: "chips", onclick: (e) => { if (e.target === box) input.focus(); } });
  const render = () => {
    clear(box);
    items.forEach((v, i) => box.append(h("span", { class: "chip" }, h("span", { title: v }, v),
      h("button", { type: "button", "aria-label": "Quitar " + v, onclick: () => { items.splice(i, 1); render(); changed(); } }, icon("x")))));
    box.append(input);
    if (datalist) box.append(datalist);
  };
  const changed = () => onChange && onChange([...items]);
  const commit = () => {
    const parts = input.value.split(",").map((s) => s.trim()).filter(Boolean);
    let added = false;
    for (let p of parts) {
      if (transform) p = transform(p);
      if (p && !items.includes(p)) { items.push(p); added = true; }
    }
    input.value = "";
    if (added) { render(); changed(); input.focus(); }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); }
    else if (e.key === "Backspace" && !input.value && items.length) { items.pop(); render(); changed(); input.focus(); }
  });
  input.addEventListener("blur", () => { if (input.value.trim()) commit(); });
  render();
  box.getValues = () => [...items];
  box.setValues = (v) => { items = [...v]; render(); };
  return box;
}

// ------------------------------------------------------------------ popover
let openPopover = null;
export function closePopover() {
  if (openPopover) { const p = openPopover; openPopover = null; p(); }
}

export function popover(anchor, content, { onClose, width } = {}) {
  closePopover();
  const el = h("div", { class: "popover", role: "dialog" }, content);
  if (width) { el.style.width = width + "px"; el.style.maxWidth = "calc(100vw - 16px)"; }
  document.body.append(el);
  const r = anchor instanceof Element ? anchor.getBoundingClientRect() : anchor;
  const w = el.offsetWidth, ht = el.offsetHeight;
  const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
  let top = r.bottom + 6;
  if (top + ht > window.innerHeight - 8) {
    top = Math.max(8, r.top - ht - 6);
    el.style.transformOrigin = "bottom left";
  }
  el.style.left = left + "px";
  el.style.top = top + "px";
  if (anchor instanceof Element) anchor.setAttribute("aria-expanded", "true");
  const onDown = (e) => { if (!el.contains(e.target)) closePopover(); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closePopover(); } };
  setTimeout(() => {
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  });
  openPopover = () => {
    el.remove();
    if (anchor instanceof Element) anchor.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    if (onClose) onClose();
  };
  const first = el.querySelector("input, button");
  if (first) first.focus();
  return closePopover;
}

// Lista filtrable de opciones (para elegir entidad, intención, agente...)
export function optionList({ groups, onPick, placeholder = "Buscar…" }) {
  const search = h("input", { type: "search", class: "search", placeholder, "aria-label": placeholder });
  const box = h("div", { class: "options", role: "listbox" });
  let focusIdx = 0;
  let flat = [];
  const render = () => {
    const q = fold(search.value.trim());
    clear(box);
    flat = [];
    for (const g of groups) {
      const opts = g.options.filter((o) => !q || fold(`${o.label} ${o.desc || ""} ${o.sub || ""}`).includes(q));
      if (!opts.length) continue;
      if (g.title) box.append(h("div", { class: "group" }, g.title));
      for (const o of opts) {
        // con «sub» la opción ocupa dos líneas (nombre y detalle debajo), como el selector de agente
        const btn = h("button", { type: "button", class: "opt" + (o.sub ? " two-line" : ""), role: "option", onclick: () => onPick(o.value, o) },
          o.dot != null ? h("span", { class: "ann-dot ann-" + o.dot }) : null,
          o.avatar ? avatar(o.avatar, o.sub ? "" : "sm") : null,
          o.icon ? icon(o.icon) : null,
          o.sub
            ? h("span", { class: "opt-text" }, h("span", { class: "ellipsis" }, o.label), h("span", { class: "opt-sub ellipsis" }, o.sub))
            : h("span", { class: "ellipsis" }, o.label),
          o.desc ? h("span", { class: "desc", title: o.desc }, o.desc) : null,
          o.selected ? icon("check", "check-mark") : null);
        flat.push(btn);
        box.append(btn);
      }
    }
    if (!flat.length) box.append(h("div", { class: "muted small", style: { padding: "8px 9px" } }, "Sin resultados"));
    focusIdx = Math.min(focusIdx, Math.max(0, flat.length - 1));
    flat.forEach((b, i) => b.classList.toggle("focus", i === focusIdx));
  };
  search.addEventListener("input", () => { focusIdx = 0; render(); });
  search.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); focusIdx = Math.min(flat.length - 1, focusIdx + 1); render(); flat[focusIdx]?.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusIdx = Math.max(0, focusIdx - 1); render(); flat[focusIdx]?.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "Enter") { e.preventDefault(); if (flat[focusIdx]) flat[focusIdx].click(); }
  });
  render();
  return h("div", null, search, box);
}

// ------------------------------------------------------------- desplegable
// Desplegable propio en lugar de <select> (el «Menú Expansible» de las plantillas): una cabecera con
// lo elegido y una flecha que gira; debajo se despliegan las opciones, separadas por una línea fina.
// Va en una capa aparte, así que no lo recortan las tablas ni las tarjetas, y se maneja con el
// teclado (flechas, Enter, Esc, inicial de la opción). Con muchas opciones lleva buscador.
// groups: [{ title?, options: [{ value, label, sub? }] }] (u options, sin grupos). Se usa como un
// <select>: .value para leer y cambiar, el evento «change» al elegir y .setOptions({ groups | options }).
let openMenu = null;
let menuSeq = 0;
export function selectMenu({ options, groups, value = null, label = "", placeholder = "Elige…", onChange, search, className = "" } = {}) {
  let list = [];
  let current = value == null ? null : String(value);
  const text = h("span", { class: "xm-text ellipsis" });
  const head = h("button", { type: "button", class: "xm-head", "aria-haspopup": "listbox", "aria-expanded": "false",
    "aria-label": label || null, onclick: () => (openMenu === close ? close(true) : open()) }, text, icon("down", "xm-arrow"));
  const box = h("div", { class: "xmenu" + (className ? " " + className : "") }, head);
  const listId = "xm-" + ++menuSeq;
  const itemsBox = h("div", { class: "xm-items" });
  const panel = h("div", { class: "xm-panel", role: "listbox", id: listId, "aria-label": label || null });
  let filter = null, items = [], active = -1, removeTimer = 0, typed = "", typedAt = 0;

  function setOptions(opts) {
    list = [];
    for (const g of opts.groups || [{ options: opts.options || [] }]) {
      for (const o of g.options) list.push({ ...o, value: String(o.value), group: g.title || "" });
    }
    paintHead();
    if (openMenu === close) renderItems();
  }
  function paintHead() {
    const o = list.find((x) => x.value === current);
    text.textContent = o ? o.label : placeholder;
    text.classList.toggle("placeholder", !o);
  }

  function renderItems() {
    const q = filter ? fold(filter.value.trim()) : "";
    clear(itemsBox);
    items = [];
    let group = null;
    for (const o of list) {
      if (q && !fold(`${o.label} ${o.sub || ""}`).includes(q)) continue;
      if (o.group && o.group !== group) { itemsBox.append(h("div", { class: "xm-group" }, o.group)); group = o.group; }
      const i = items.length;
      const on = o.value === current;
      const el = h("div", { class: "xm-item" + (on ? " sel" : ""), role: "option", id: `${listId}-${i}`, "aria-selected": String(on),
        style: { "--i": Math.min(i, 10) }, onmousedown: (e) => e.preventDefault(), onmousemove: () => setActive(i, false),
        onclick: () => pick(o.value) },
      h("span", { class: "xm-label" }, h("span", { class: "ellipsis" }, o.label), o.sub ? h("span", { class: "xm-sub ellipsis" }, o.sub) : null),
      on ? icon("check", "xm-check") : null);
      items.push({ el, o });
      itemsBox.append(el);
    }
    if (!items.length) itemsBox.append(h("div", { class: "xm-empty" }, "Sin resultados"));
    const sel = items.findIndex((x) => x.o.value === current);
    setActive(q ? 0 : Math.max(0, sel), q ? "nearest" : "center");
  }
  function setActive(i, scroll) {
    if (!items.length) { active = -1; return; }
    active = Math.max(0, Math.min(items.length - 1, i));
    items.forEach((x, j) => x.el.classList.toggle("active", j === active));
    head.setAttribute("aria-activedescendant", items[active].el.id);
    if (scroll) items[active].el.scrollIntoView({ block: scroll === true ? "nearest" : scroll });
  }

  function place() {
    const r = head.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8, above = r.top - 8;
    const up = below < 220 && above > below;
    panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8)) + "px";
    panel.style.width = r.width + "px";
    panel.style.maxHeight = Math.max(120, Math.min(340, up ? above : below)) + "px";
    panel.style.top = up ? "" : r.bottom - 1 + "px";
    panel.style.bottom = up ? window.innerHeight - r.top - 1 + "px" : "";
    box.classList.toggle("up", up);
    panel.classList.toggle("up", up);
  }
  const onDown = (e) => { if (!panel.contains(e.target) && !head.contains(e.target)) close(); };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.key === "Tab") { close(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setActive(active + (e.key === "ArrowDown" ? 1 : -1), true); return; }
    if (e.key === "Home" || e.key === "End") { e.preventDefault(); setActive(e.key === "Home" ? 0 : items.length - 1, true); return; }
    if (e.key === "Enter" || (e.key === " " && !filter)) { e.preventDefault(); if (items[active]) pick(items[active].o.value); return; }
    // sin buscador: la inicial salta a la siguiente opción que empieza así
    if (!filter && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      typed = (Date.now() - typedAt < 700 ? typed : "") + fold(e.key);
      typedAt = Date.now();
      const from = typed.length === 1 ? active + 1 : active;
      const n = items.length;
      for (let k = 0; k < n; k++) {
        const j = (from + k) % n;
        if (fold(items[j].o.label).startsWith(typed)) { setActive(j, true); break; }
      }
    }
  };
  const onMove = () => place();

  function open() {
    if (head.disabled) return;
    if (openMenu) openMenu();
    closePopover();
    clearTimeout(removeTimer);
    panel.classList.remove("closing");
    clear(panel);
    filter = null;
    if (search ?? list.length > 10) {
      filter = h("input", { type: "search", class: "xm-search", placeholder: "Buscar…", "aria-label": "Buscar",
        oninput: () => renderItems() });
      panel.append(filter);
    }
    panel.append(itemsBox);
    document.body.append(panel);
    place();  // antes de pintar las opciones: con la altura ya fijada, la elegida queda a la vista
    renderItems();
    box.classList.add("open");
    head.setAttribute("aria-expanded", "true");
    head.setAttribute("aria-controls", listId);
    openMenu = close;
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    if (filter) filter.focus();
  }
  function close(focusHead = false) {
    if (openMenu !== close) return;
    openMenu = null;
    box.classList.remove("open", "up");
    head.setAttribute("aria-expanded", "false");
    head.removeAttribute("aria-activedescendant");
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("scroll", onMove, true);
    window.removeEventListener("resize", onMove);
    panel.classList.add("closing");
    removeTimer = setTimeout(() => panel.remove(), reducedMotion() ? 0 : 140);
    if (focusHead) head.focus();
  }
  function pick(v) {
    const changed = v !== current;
    current = v;
    paintHead();
    close(true);
    if (!changed) return;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    if (onChange) onChange(v);
  }

  Object.defineProperty(box, "value", { get: () => current, set: (v) => { current = v == null ? null : String(v); paintHead(); } });
  Object.defineProperty(box, "disabled", { get: () => head.disabled, set: (v) => { head.disabled = !!v; } });
  box.setOptions = setOptions;
  box.focus = () => head.focus();
  setOptions({ options, groups });
  return box;
}

// -------------------------------------------------------- selector de color
// En lugar del selector del navegador, el «Color Picker HSV» de las plantillas: un botón con la
// muestra y el código abre un panel con el cuadro de saturación y brillo, la barra de tono, el
// código hexadecimal y colores sugeridos. onChange(hex) en cada cambio, para verlo al momento.
const COLOR_PRESETS = ["#4f46e5", "#7c3aed", "#c026d3", "#db2777", "#e11d48", "#ea580c",
  "#d97706", "#16a34a", "#0d9488", "#0891b2", "#2563eb", "#334155"];

function hexToRgb(hex) {
  let v = String(hex || "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(v)) v = v.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(v)) return null;
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
}
const rgbToHex = (rgb) => "#" + rgb.map((x) => x.toString(16).padStart(2, "0")).join("");
function hsvToRgb(hue, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((hue / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((k) => Math.round((k + m) * 255));
}
function rgbToHsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let hue = 0;
  if (d) hue = 60 * (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4);
  return [(hue + 360) % 360, max ? d / max : 0, max];
}

export function colorPicker({ value = "#4f46e5", onChange, label = "Color" } = {}) {
  let hex = rgbToHex(hexToRgb(value) || [79, 70, 229]);
  let [hue, sat, bri] = rgbToHsv(hexToRgb(hex));
  const swatch = h("span", { class: "cp-swatch" });
  const code = h("span", { class: "cp-code" });
  const btn = h("button", { type: "button", class: "cp-btn", "aria-label": label, "aria-haspopup": "dialog", onclick: () => openPanel() },
    swatch, code, icon("down", "cp-arrow"));
  let ui = null, frame = 0;

  const paint = () => {
    swatch.style.background = hex;
    code.textContent = hex.toUpperCase();
    if (!ui) return;
    ui.cursor.style.left = sat * 100 + "%";
    ui.cursor.style.top = (1 - bri) * 100 + "%";
    ui.cursor.style.background = hex;
    ui.field.setAttribute("aria-valuetext", `saturación ${Math.round(sat * 100)} %, brillo ${Math.round(bri * 100)} %`);
    ui.prev.style.background = hex;
    if (document.activeElement !== ui.hex) ui.hex.value = hex.toUpperCase();
    ui.hue.value = String(Math.round(hue));
    ui.dots.forEach((d) => d.classList.toggle("on", d.dataset.c === hex));
  };
  // los cambios se avisan una vez por fotograma (arrastrar dispara muchos)
  const changed = () => {
    paint();
    if (!onChange || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; onChange(hex); });
  };
  const fromHsv = () => { hex = rgbToHex(hsvToRgb(hue, sat, bri)); changed(); };
  const setHex = (v) => {
    const rgb = hexToRgb(v);
    if (!rgb) return false;
    hex = rgbToHex(rgb);
    [hue, sat, bri] = rgbToHsv(rgb);
    if (ui) drawField();
    changed();
    return true;
  };

  function drawField() {
    const { canvas } = ui;
    const ctx = canvas.getContext("2d");
    const w = canvas.width, ht = canvas.height;
    const across = ctx.createLinearGradient(0, 0, w, 0);
    across.addColorStop(0, "#fff");
    across.addColorStop(1, `hsl(${hue}, 100%, 50%)`);
    ctx.fillStyle = across;
    ctx.fillRect(0, 0, w, ht);
    const down = ctx.createLinearGradient(0, 0, 0, ht);
    down.addColorStop(0, "rgba(0, 0, 0, 0)");
    down.addColorStop(1, "#000");
    ctx.fillStyle = down;
    ctx.fillRect(0, 0, w, ht);
  }

  function openPanel() {
    const canvas = h("canvas", { class: "cp-canvas" });
    const cursor = h("span", { class: "cp-cursor" });
    const field = h("div", { class: "cp-field", tabindex: "0", role: "slider", "aria-label": "Saturación y brillo" }, canvas, cursor);
    const hueIn = h("input", { type: "range", class: "cp-hue", min: "0", max: "360", step: "1", "aria-label": "Tono",
      oninput: () => { hue = +hueIn.value; drawField(); fromHsv(); } });
    const hexIn = h("input", { type: "text", class: "cp-hex", maxlength: "7", spellcheck: "false", autocomplete: "off",
      "aria-label": "Código del color", oninput: () => { if (setHex(hexIn.value)) hexIn.classList.remove("bad"); else hexIn.classList.add("bad"); },
      onblur: () => { hexIn.classList.remove("bad"); paint(); } });
    const prev = h("span", { class: "cp-prev" });
    const dots = COLOR_PRESETS.map((c) => h("button", { type: "button", class: "cp-dot", title: c.toUpperCase(), "aria-label": c,
      dataset: { c }, style: { background: c }, onclick: () => setHex(c) }));
    const box = h("div", { class: "cp-panel" }, field, hueIn,
      h("div", { class: "cp-row" }, prev, hexIn), h("div", { class: "cp-dots" }, dots));
    ui = { canvas, cursor, field, hue: hueIn, hex: hexIn, prev, dots };

    const pickAt = (e) => {
      const r = field.getBoundingClientRect();
      sat = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      bri = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      fromHsv();
    };
    field.addEventListener("pointerdown", (e) => { field.setPointerCapture(e.pointerId); field.classList.add("drag"); pickAt(e); });
    field.addEventListener("pointermove", (e) => { if (field.hasPointerCapture(e.pointerId)) pickAt(e); });
    field.addEventListener("pointerup", () => field.classList.remove("drag"));
    field.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 0.1 : 0.02;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
      if (!moves) return;
      e.preventDefault();
      sat = Math.max(0, Math.min(1, sat + moves[0]));
      bri = Math.max(0, Math.min(1, bri + moves[1]));
      fromHsv();
    });
    popover(btn, box, { onClose: () => { ui = null; btn.classList.remove("open"); } });
    btn.classList.add("open");
    // el lienzo, a la resolución de la pantalla
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(field.clientWidth * dpr);
    canvas.height = Math.round(field.clientHeight * dpr);
    drawField();
    paint();
  }

  paint();
  Object.defineProperty(btn, "value", { get: () => hex, set: (v) => { setHex(v); } });
  return btn;
}

// --------------------------------------------------------------------- tema
// Claro u oscuro (oscuro clásico: grises neutros). Se guarda en localStorage y lo
// comparten la consola y la referencia de la API.
export function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", isDark() ? "#111111" : "#f7f7f8");
}

// Cambia el tema; la página nueva aparece en un círculo que crece desde el botón
export function toggleTheme(e) {
  const next = isDark() ? "light" : "dark";
  const apply = () => {
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("agente.theme", next); } catch (err) { /* sin almacenamiento local */ }
    for (const b of document.querySelectorAll(".theme-btn")) clear(b).append(icon(next === "dark" ? "sun" : "moon"));
    syncThemeColor();
  };
  if (!document.startViewTransition || reducedMotion()) { apply(); return; }
  const r = e && e.currentTarget && e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : null;
  const x = r ? r.left + r.width / 2 : window.innerWidth / 2;
  const y = r ? r.top + r.height / 2 : window.innerHeight / 2;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const t = document.startViewTransition(apply);
  t.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)", pseudoElement: "::view-transition-new(root)" });
  }).catch(() => { /* sin animación */ });
}

export function themeButton(cls = "btn ghost sm icon-only theme-btn") {
  return h("button", { class: cls, type: "button", title: "Cambiar tema", "aria-label": "Cambiar tema claro u oscuro",
    onclick: toggleTheme }, icon(isDark() ? "sun" : "moon"));
}

// ----------------------------------------------------------------- tooltips
// Sustituye el «title» del navegador por un globo propio (más rápido y con el
// estilo de la consola). El atributo se guarda mientras se muestra y se repone después.
export function initTooltips() {
  let tip = null, timer = 0, target = null;
  const hide = () => {
    clearTimeout(timer);
    if (tip) { tip.remove(); tip = null; }
    if (target && target.dataset.tipTitle != null) {
      target.setAttribute("title", target.dataset.tipTitle);
      delete target.dataset.tipTitle;
    }
    target = null;
  };
  const show = () => {
    if (!target || !target.isConnected) { hide(); return; }
    const text = target.dataset.tipTitle ?? target.dataset.tip;
    if (!text) return;
    tip = h("div", { class: "tip", role: "tooltip" }, text);
    document.body.append(tip);
    const r = target.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let top = r.top - th - 8;
    if (top < 6) top = r.bottom + 8;
    const left = Math.max(6, Math.min(window.innerWidth - tw - 6, r.left + r.width / 2 - tw / 2));
    tip.style.top = top + "px";
    tip.style.left = left + "px";
  };
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch" || !(e.target instanceof Element)) return;
    const el = e.target.closest("[title]:not([title='']), [data-tip]");
    if (el === target) return;
    hide();
    if (!el) return;
    target = el;
    if (el.hasAttribute("title")) {
      el.dataset.tipTitle = el.getAttribute("title");
      el.removeAttribute("title");
    }
    timer = setTimeout(show, 420);
  });
  document.addEventListener("pointerout", (e) => {
    if (target && (!e.relatedTarget || !target.contains(e.relatedTarget))) hide();
  });
  for (const ev of ["pointerdown", "keydown", "wheel"]) document.addEventListener(ev, hide, true);
  window.addEventListener("scroll", hide, true);
  window.addEventListener("blur", hide);
}

// ------------------------------------------------------------------- varios
export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// minúsculas y sin tildes, para buscar
export function fold(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
export function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.round(ts - Date.now() / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return "ahora mismo";
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(s / 86400), "day");
  return new Date(ts * 1000).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
}

export function fullDate(ts) {
  return ts ? new Date(ts * 1000).toLocaleString("es-ES") : "";
}

export async function copyText(text, silent = false) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = h("textarea", { style: { position: "fixed", opacity: "0" } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  if (!silent) toast("Copiado al portapapeles", "success", 1500);
}

export function downloadFile(filename, content, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Botón «Copiar» que se convierte un momento en «Copiado»
export function copyButton(getText, { label = "Copiar", cls = "btn sm ghost copy" } = {}) {
  const btn = h("button", { class: cls, type: "button", title: label ? null : "Copiar", "aria-label": label || "Copiar" }, icon("copy"), label);
  let timer = 0;
  btn.addEventListener("click", async () => {
    await copyText(typeof getText === "function" ? getText() : getText, true);
    clearTimeout(timer);
    clear(btn).append(icon("check"), label ? "Copiado" : null);
    btn.classList.add("done");
    timer = setTimeout(() => { clear(btn).append(icon("copy"), label); btn.classList.remove("done"); }, 1500);
  });
  return btn;
}

export function codeBlock(code, { lang = "", json = false } = {}) {
  const pre = h("pre", null, json ? highlightJSON(code) : code);
  const copy = copyButton(code);
  return h("div", { class: "code-block" },
    lang ? h("div", { class: "code-head" }, h("span", { class: "lang" }, lang), copy) : copy, pre);
}

// Varios fragmentos de código con pestañas (curl / JavaScript / Python…)
export function codeTabs(items) {
  let cur = 0;
  const pre = h("pre");
  const show = (i) => {
    cur = i;
    tabs.forEach((t, j) => { t.classList.toggle("active", j === i); t.setAttribute("aria-selected", String(j === i)); });
    clear(pre).append(...[items[i].json ? highlightJSON(items[i].code) : items[i].code].flat());
  };
  const tabs = items.map((it, i) => h("button", { type: "button", class: "code-tab", role: "tab", onclick: () => show(i) }, it.label));
  const box = h("div", { class: "code-block" },
    h("div", { class: "code-head", role: "tablist" }, tabs, copyButton(() => items[cur].code)), pre);
  show(0);
  return box;
}

// Resaltado de JSON (o casi JSON) con nodos de texto: claves, cadenas, números…
export function highlightJSON(text) {
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],])/g;
  const out = [];
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      out.push(h("span", { class: m[2] ? "tok-key" : "tok-str" }, m[1]));
      if (m[2]) out.push(h("span", { class: "tok-punc" }, m[2]));
    } else if (m[3]) out.push(h("span", { class: "tok-bool" }, m[3]));
    else if (m[4]) out.push(h("span", { class: "tok-null" }, m[4]));
    else if (m[5]) out.push(h("span", { class: "tok-num" }, m[5]));
    else out.push(h("span", { class: "tok-punc" }, m[6]));
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function formatValue(v) {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function pct(v) {
  return Math.round((v || 0) * 100) + " %";
}

/**
 * Cómo se ha leído una frase (Analizador y Entrenar): una columna por palabra y una fila por paso,
 * como una glosa: lo escrito, la forma normalizada, la raíz y, si hay, la corrección y la entidad.
 * Lo que cambia en un paso se resalta; lo que se queda igual, atenuado. Al pasar el ratón por una
 * palabra se ilumina su columna. entities: [{ start, end, entity }]; entColor(e): su color (0-7).
 */
const TOKEN_KIND = { word: "palabra", number: "número", time: "hora", date: "fecha", url: "dirección web", email: "correo", symbol: "signo" };
export function tokenGloss(tokens, { entities = [], entColor = () => 0 } = {}) {
  const entAt = (t) => entities.find((e) => t.start >= e.start && t.end <= e.end);
  const rows = [
    { label: "Escrito", tip: "La palabra tal como está en la frase" },
    { label: "Normalizada", tip: "En minúsculas, sin tildes, sin letras repetidas y con las abreviaturas de chat desplegadas" },
    { label: "Raíz", tip: "Lo que queda al quitar las terminaciones: «reservar», «reserva» y «reservas» se quedan en «reserv». Los números, horas y fechas no tienen raíz" },
  ];
  const corrected = tokens.some((t) => t.corrected);
  if (corrected) rows.push({ label: "Corregida", tip: "El corrector cambia una palabra que no conoce por la más parecida del vocabulario del agente" });
  if (entities.length) rows.push({ label: "Entidad", tip: "Las palabras que son un dato: el modelo las ve por su tipo (@pizza), no por la palabra" });
  const grid = h("div", { class: "gloss", role: "table", "aria-label": "Tokenización de la frase" });
  const put = (row, col, span, content, cls, title) => grid.append(h("div", {
    class: `gl-cell${row === 1 ? " first" : ""}${cls ? " " + cls : ""}`, role: "cell", title: title || null,
    dataset: { col: String(col), span: String(span) }, style: { gridRow: row, gridColumn: `${col + 2} / span ${span}`, "--i": Math.min(col, 16) } },
  content));
  rows.forEach((r, i) => grid.append(h("div", { class: "gl-label" + (i ? "" : " first"), role: "rowheader", title: r.tip,
    style: { gridRow: i + 1 } }, r.label)));

  tokens.forEach((t, c) => {
    const e = entAt(t);
    const sym = t.kind === "symbol";
    const tip = [TOKEN_KIND[t.kind] || t.kind, t.stop ? "palabra vacía: cuenta poco" : "", t.expanded ? "abreviatura desplegada" : "", e ? e.entity : ""]
      .filter(Boolean).join(" · ");
    const word = e ? h("mark", { class: "gl-mark ann-" + entColor(e) }, t.text) : t.text;
    // una abreviatura que se despliega en varias palabras («xfa» → «por favor») va en una sola casilla
    const same = (x) => x && x.start === t.start && x.end === t.end;
    if (!same(tokens[c - 1])) {
      let span = 1;
      while (same(tokens[c + span])) span++;
      put(1, c, span, word, "gl-word" + (t.stop ? " stop" : "") + (sym ? " sym" : ""), tip);
    }
    put(2, c, 1, sym ? "" : t.norm, "gl-mono" + (!sym && t.norm !== t.text ? " diff" : ""),
      !sym && t.norm !== t.text ? (t.expanded ? "Abreviatura desplegada" : "Cambia al normalizar") : null);
    put(3, c, 1, sym ? "" : t.kind === "word" ? t.stem : TOKEN_KIND[t.kind] || t.kind,
      t.kind === "word" ? "gl-mono" + (t.stem !== t.norm ? " diff" : "") : sym ? "" : "gl-kind");
    let row = 4;
    if (corrected) put(row++, c, 1, t.corrected ? "→ " + t.corrected : "", t.corrected ? "gl-corr" : "");
    if (entities.length) {
      const prev = tokens[c - 1];
      if (e && prev && entAt(prev) === e) return;  // va dentro de la casilla de la primera palabra
      let span = 1;
      while (e && tokens[c + span] && entAt(tokens[c + span]) === e) span++;
      put(row, c, span, e ? h("span", { class: "gl-ent ann-" + entColor(e) }, e.entity) : "", e ? "gl-entcell" : "");
    }
  });

  // al pasar el ratón por una palabra se ilumina su columna
  let lit = null;
  const light = (col) => {
    if (col === lit) return;
    lit = col;
    grid.querySelectorAll(".gl-cell.lit").forEach((x) => x.classList.remove("lit"));
    if (col == null) return;
    grid.querySelectorAll(".gl-cell").forEach((x) => {
      const from = +x.dataset.col, to = from + +x.dataset.span;
      if (col >= from && col < to) x.classList.add("lit");
    });
  };
  grid.addEventListener("mouseover", (ev) => {
    const cell = ev.target.closest(".gl-cell");
    if (cell) light(+cell.dataset.col);
  });
  grid.addEventListener("mouseleave", () => light(null));
  return h("div", { class: "table-scroll gloss-wrap" }, grid);
}

// La parte rellena de un deslizador (--fill en app.css) llega justo hasta el centro del tirador, que
// recorre la barra menos su propio ancho (20 px). Hay que llamarla también al cambiar el valor por código.
export function rangeFill(input) {
  const min = +input.min || 0, max = +input.max || 100;
  const t = max > min ? (+input.value - min) / (max - min) : 0;
  input.style.setProperty("--fill", `calc(10px + (100% - 20px) * ${Math.max(0, Math.min(1, t))})`);
  return input;
}

export function confBar(value, threshold) {
  const bar = h("div", { class: "conf-bar" + (threshold != null && value < threshold ? " low" : "") },
    h("span", { style: { width: Math.round(Math.max(0, Math.min(1, value)) * 100) + "%" } }));
  if (threshold != null) bar.append(h("div", { class: "thr", style: { left: Math.round(threshold * 100) + "%" }, title: "Umbral" }));
  return bar;
}

export function switchInput(label, checked, onChange, hint) {
  const input = h("input", { type: "checkbox", checked, onchange: () => onChange(input.checked) });
  return h("label", { class: "switch" }, input, h("span", null, label, hint ? h("div", { class: "muted small" }, hint) : null));
}

// Cabecera de página: icono, título, subtítulo y acciones
// Título y botones van en dos bloques: si no caben en una línea, los botones bajan a la
// siguiente en vez de estrujar el texto (pasa con el simulador abierto en pantallas medianas).
export function pageHead({ icon: ic, title, sub, actions = [], crumbs, sticky = false, titleNode }) {
  const acts = [actions].flat().filter(Boolean);
  return h("div", { class: "page-head" + (sticky ? " sticky" : "") },
    h("div", { class: "head-main" },
      ic ? h("div", { class: "page-icon" }, icon(ic)) : null,
      h("div", { class: "head-text" },
        crumbs ? h("div", { class: "crumbs" }, crumbs.map((c, i) => [i ? icon("chevRight") : null,
          c.href ? h("a", { href: c.href }, c.label) : h("span", null, c.label)])) : null,
        titleNode || h("h1", null, title),
        sub ? h("div", { class: "sub" }, sub) : null)),
    acts.length ? h("div", { class: "head-actions" }, acts) : null);
}

// Estado vacío con icono, título, texto y acción
export function emptyState({ icon: ic = "inbox", title, text, action }) {
  return h("div", { class: "empty" }, h("span", { class: "empty-icon" }, icon(ic)),
    title ? h("div", { class: "empty-title" }, title) : null,
    text ? h("p", null, text) : null, action || null);
}

// Esqueleto de carga mientras llega una página
export function skeletonPage() {
  const bar = (w, ht, extra = {}) => h("div", { class: "skel", style: { width: w, height: ht + "px", ...extra } });
  return h("div", { class: "skel-page", "aria-busy": "true", "aria-label": "Cargando" },
    h("div", { class: "skel-head" }, bar("42px", 42, { borderRadius: "12px", flex: "none" }),
      h("div", { class: "col grow", style: { gap: "9px" } }, bar("220px", 20), bar("min(420px, 70%)", 12))),
    h("div", { class: "card", style: { padding: "20px" } },
      h("div", { class: "col", style: { gap: "16px" } }, ["72%", "88%", "54%", "80%", "64%", "40%"].map((w) => bar(w, 12)))));
}

// Cuenta desde 0 hasta el valor (cifras de las tarjetas de estadísticas)
export function countUp(el, to, fmt = (v) => String(Math.round(v)), ms = 750) {
  if (typeof to !== "number" || !isFinite(to) || reducedMotion()) { el.textContent = fmt(to); return el; }
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    el.textContent = fmt(to * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  el.textContent = fmt(0);
  requestAnimationFrame(step);
  return el;
}

// Hace aparecer los hijos de un contenedor uno detrás de otro
export function stagger(container, max = 14) {
  if (reducedMotion()) return container;
  [...container.children].forEach((c, i) => c.style.setProperty("--i", Math.min(i, max)));
  container.classList.add("stagger");
  setTimeout(() => container.classList.remove("stagger"), 420 + max * 28);
  return container;
}

// Pone un botón en estado «cargando» mientras dura la promesa
export async function busy(btn, fn) {
  btn.classList.add("loading");
  btn.disabled = true;
  try {
    return await fn();
  } finally {
    btn.classList.remove("loading");
    btn.disabled = false;
  }
}

/**
 * Pestañas segmentadas con un indicador que se desliza hasta la activa.
 * items: [{ key, label, badge? }]. Devuelve el contenedor .tabs (con select(key)).
 */
export function segmented({ items, active, onChange, label }) {
  const box = h("div", { class: "tabs has-ind", role: "tablist", "aria-label": label || null });
  const ind = h("span", { class: "tabs-ind", "aria-hidden": "true" });
  const btns = items.map((it) => h("button", { type: "button", role: "tab", onclick: () => select(it.key, true) },
    it.label, it.badge != null ? h("span", { class: "badge" }, String(it.badge)) : null));
  box.append(ind, ...btns);
  const place = (anim) => {
    const b = btns[items.findIndex((x) => x.key === active)];
    if (!b || !b.offsetWidth) return;
    ind.classList.toggle("anim", anim && !reducedMotion());
    ind.style.width = b.offsetWidth + "px";
    ind.style.transform = `translateX(${b.offsetLeft}px)`;
  };
  function select(key, fire) {
    active = key;
    btns.forEach((b, i) => {
      const on = items[i].key === key;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
    });
    place(true);
    if (fire && onChange) onChange(key);
  }
  select(active, false);
  if (window.ResizeObserver) new ResizeObserver(() => place(false)).observe(box);
  box.select = (key) => select(key, false);
  return box;
}

/**
 * Índice de una página larga (la Guía, «Por dentro»). Con sitio, una lista fija junto al texto; con la
 * zona central estrecha (simulador abierto o móvil), una barra pegada arriba que dice en qué sección
 * estás y despliega la lista. items: [{ text, target: () => elemento }]; extra: más nodos debajo de la
 * lista (otros enlaces). Devuelve { el, go(elemento), destroy }.
 */
export function tocNav({ label = "Índice", items, extra = null, scroller }) {
  const listId = "toc-" + Math.random().toString(36).slice(2, 8);
  const now = h("span", { class: "toc-now ellipsis" }, items[0] ? items[0].text : "");
  const toggle = h("button", { class: "toc-toggle", type: "button", "aria-expanded": "false", "aria-controls": listId,
    onclick: () => setOpen(!open) }, icon("list"), h("span", { class: "toc-label" }, "Contenido"), now, icon("down", "toc-chev"));
  const links = items.map((it) => h("a", { href: "#", onclick: (e) => { e.preventDefault(); setOpen(false); go(it.target()); } }, it.text));
  const list = h("div", { class: "toc-list", id: listId }, h("div", { class: "toc-title" }, "Contenido"), links, extra);
  const nav = h("nav", { class: "toc", "aria-label": label }, toggle, list);
  // el botón del desplegable solo se ve con la zona estrecha (lo decide el CSS)
  const compact = () => toggle.offsetParent !== null;
  const stickTop = () => parseFloat(getComputedStyle(nav).top) || 0;

  let open = false;
  const onDown = (e) => { if (!nav.contains(e.target)) setOpen(false); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); toggle.focus(); } };
  function setOpen(value) {
    if (value === open) return;
    open = value;
    nav.classList.toggle("open", value);
    toggle.setAttribute("aria-expanded", String(value));
    const method = value ? "addEventListener" : "removeEventListener";
    document[method]("mousedown", onDown, true);
    document[method]("keydown", onKey, true);
    if (value) list.querySelector("a.active")?.scrollIntoView({ block: "nearest" });
  }
  nav.addEventListener("focusout", (e) => { if (open && !nav.contains(e.relatedTarget)) setOpen(false); });

  // salta a una sección; con la barra pegada arriba, la deja justo debajo de ella
  let settle = 0;
  const stopSettle = () => { clearTimeout(settle); settle = 0; };
  function go(node) {
    if (!node) return;
    stopSettle();
    const behavior = reducedMotion() ? "auto" : "smooth";
    if (!scroller) { node.scrollIntoView({ behavior, block: "start" }); return; }
    const want = () => {
      const gap = compact() ? stickTop() + nav.offsetHeight + 12 : parseFloat(getComputedStyle(node).scrollMarginTop) || 0;
      const y = scroller.scrollTop + node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - gap;
      return Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, Math.round(y)));
    };
    scroller.scrollTo({ top: want(), behavior });
    // lo de arriba puede cambiar de alto mientras tanto (imágenes que se cargan al pasar, datos que
    // llegan): cuando se para, se corrige hasta que la sección quede en su sitio
    let last = -1, rounds = 0;
    const tick = () => {
      const y = scroller.scrollTop;
      if (y !== last) { last = y; settle = setTimeout(tick, 120); return; }
      if (Math.abs(want() - y) > 2 && rounds++ < 5) {
        scroller.scrollTo({ top: want(), behavior });
        last = -1;
        settle = setTimeout(tick, 120);
        return;
      }
      settle = 0;
    };
    settle = setTimeout(tick, 120);
  }

  // resalta la sección que se está leyendo: la última que ha pasado la línea de lectura
  let frame = 0;
  const spy = () => {
    frame = 0;
    if (!scroller || !nav.isConnected) return;
    const top = scroller.getBoundingClientRect().top;
    const small = compact();
    const line = small ? nav.getBoundingClientRect().bottom + 24 : top + 120;
    let current = 0;
    items.forEach((it, i) => { const node = it.target(); if (node && node.getBoundingClientRect().top <= line) current = i; });
    // al final de la página la última sección no llega a la línea: si se ve, es la que se lee
    if (scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) current = items.length - 1;
    links.forEach((a, i) => a.classList.toggle("active", i === current));
    if (items[current]) now.textContent = items[current].text;
    nav.classList.toggle("stuck", small && scroller.scrollTop > 0 && nav.getBoundingClientRect().top <= top + stickTop() + 0.5);
  };
  const onScroll = () => { if (!frame) frame = requestAnimationFrame(spy); };
  // si quien lee mueve la página, se deja de corregir el salto
  const userScroll = ["wheel", "touchstart", "keydown", "mousedown"];
  if (scroller) {
    scroller.addEventListener("scroll", onScroll, { passive: true });
    userScroll.forEach((type) => scroller.addEventListener(type, stopSettle, { passive: true }));
  }
  window.addEventListener("resize", onScroll);
  onScroll();
  return {
    el: nav,
    go,
    destroy: () => {
      setOpen(false);
      stopSettle();
      if (scroller) {
        scroller.removeEventListener("scroll", onScroll);
        userScroll.forEach((type) => scroller.removeEventListener(type, stopSettle));
      }
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    },
  };
}

/**
 * Tabla con columnas ordenables (clic en la cabecera). Al ordenar, las filas se
 * desplazan hasta su nuevo sitio con una animación.
 * columns: [{ label, key?, value?(fila) para ordenar, render?(fila), num? (cifra: a la derecha),
 *            desc? (primero de mayor a menor), width?, sortable?, className? }]
 */
export function dataTable({ columns, rows, sort = null, className = "", empty = "Sin datos", scroll = false }) {
  let sortIdx = sort ? sort.col : -1;
  let dir = sort ? sort.dir || "asc" : "asc";
  const coll = new Intl.Collator("es", { numeric: true, sensitivity: "base" });
  const valueOf = (c, row) => (c.value ? c.value(row) : row[c.key]);
  const tbody = h("tbody");
  const trs = rows.map((row) => {
    const tr = h("tr", null, columns.map((c) => h("td", { class: [c.num ? "num" : "", c.className || ""].join(" ").trim() || null },
      c.render ? c.render(row) : formatValue(valueOf(c, row)))));
    tr._row = row;
    return tr;
  });
  const ths = columns.map((c, i) => {
    const sortable = c.sortable !== false && (c.value || c.key);
    const th = h("th", { class: [c.num ? "num" : "", sortable ? "sortable" : ""].join(" ").trim() || null, scope: "col",
      style: c.width ? { width: c.width } : null, tabindex: sortable ? "0" : null },
    c.label, sortable ? icon("arrowUp", "sort-ind") : null);
    if (sortable) {
      const go = () => {
        if (sortIdx === i) dir = dir === "asc" ? "desc" : "asc";
        else { sortIdx = i; dir = c.num || c.desc ? "desc" : "asc"; }
        apply(true);
      };
      th.addEventListener("click", go);
      th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    }
    return th;
  });
  const apply = (animate) => {
    ths.forEach((th, i) => {
      if (i === sortIdx) th.setAttribute("aria-sort", dir === "asc" ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
    });
    const order = trs.map((tr, i) => [tr, i]);
    if (sortIdx >= 0) {
      const c = columns[sortIdx];
      order.sort(([a, ia], [b, ib]) => {
        const va = valueOf(c, a._row), vb = valueOf(c, b._row);
        if (va == null || vb == null) return (va == null) - (vb == null) || ia - ib; // vacíos al final
        const r = typeof va === "number" && typeof vb === "number" ? va - vb : coll.compare(String(va), String(vb));
        return (dir === "asc" ? r : -r) || ia - ib;
      });
    }
    const before = animate && !reducedMotion() ? new Map(trs.map((tr) => [tr, tr.getBoundingClientRect().top])) : null;
    tbody.append(...order.map(([tr]) => tr));
    if (before) {
      for (const [tr, top] of before) {
        const dy = top - tr.getBoundingClientRect().top;
        if (dy) tr.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 340, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    }
  };
  if (!rows.length) tbody.append(h("tr", null, h("td", { colspan: String(columns.length), class: "table-empty" }, empty)));
  else apply(false);
  return h("div", { class: "table-wrap" + (scroll ? " scroll" : "") },
    h("table", { class: ("table " + className).trim() }, h("thead", null, h("tr", null, ths)), tbody));
}
