// Utilidades de interfaz. Todo el texto se inserta como nodos de texto (nunca
// como HTML), así que el contenido de los usuarios no puede inyectar código.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "dataset") Object.assign(el.dataset, v);
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

const ICONS = {
  logo: '<path d="M5 7h14M5 12h9M5 17h6"/>',
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
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13v1M15 13v1"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
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
};

export function icon(name, cls = "") {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("class", "icon " + cls);
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = ICONS[name] || "";
  return el;
}

// ------------------------------------------------------------------ toasts
let toastBox;
export function toast(message, type = "info", ms = 2600) {
  if (!toastBox) {
    toastBox = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
    document.body.append(toastBox);
  }
  const t = h("div", { class: "toast " + type }, message);
  toastBox.append(t);
  setTimeout(() => t.remove(), type === "error" ? Math.max(ms, 5000) : ms);
}

export function errorToast(err) {
  toast(err && err.message ? err.message : String(err), "error");
}

// ------------------------------------------------------------------ modales
export function modal({ title, body, actions = [], wide = false, onOpen }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const close = (value) => {
      back.remove();
      document.removeEventListener("keydown", onKey, true);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); close(null); }
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
    const box = h("div", { class: "modal" + (wide ? " wide" : ""), role: "dialog", "aria-modal": "true" },
      h("div", { class: "modal-head" }, h("h3", null, title), h("div", { class: "spacer" }),
        h("button", { class: "btn ghost sm icon-only", type: "button", "aria-label": "Cerrar", onclick: () => close(null) }, icon("x"))),
      h("div", { class: "modal-body" }, body),
      actions.length ? foot : null);
    const back = h("div", { class: "modal-back", onmousedown: (e) => { if (e.target === back) close(null); } }, box);
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
    body: h("p", { style: { margin: 0 } }, message),
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

export function popover(anchor, content, { onClose } = {}) {
  closePopover();
  const el = h("div", { class: "popover", role: "dialog" }, content);
  document.body.append(el);
  const r = anchor instanceof Element ? anchor.getBoundingClientRect() : anchor;
  const w = el.offsetWidth, ht = el.offsetHeight;
  let left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
  let top = r.bottom + 6;
  if (top + ht > window.innerHeight - 8) top = Math.max(8, r.top - ht - 6);
  el.style.left = left + "px";
  el.style.top = top + "px";
  const onDown = (e) => { if (!el.contains(e.target)) closePopover(); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closePopover(); } };
  setTimeout(() => {
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  });
  openPopover = () => {
    el.remove();
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    if (onClose) onClose();
  };
  const first = el.querySelector("input, button");
  if (first) first.focus();
  return closePopover;
}

// Lista filtrable de opciones (para elegir entidad, intención...)
export function optionList({ groups, onPick, placeholder = "Buscar…" }) {
  const search = h("input", { type: "search", class: "search", placeholder, "aria-label": placeholder });
  const box = h("div", { class: "options", role: "listbox" });
  let focusIdx = 0;
  let flat = [];
  const render = () => {
    const q = search.value.trim().toLowerCase();
    clear(box);
    flat = [];
    for (const g of groups) {
      const opts = g.options.filter((o) => !q || (o.label + " " + (o.desc || "")).toLowerCase().includes(q));
      if (!opts.length) continue;
      if (g.title) box.append(h("div", { class: "group" }, g.title));
      for (const o of opts) {
        const btn = h("button", { type: "button", class: "opt", role: "option", onclick: () => onPick(o.value, o) },
          o.dot != null ? h("span", { class: "ann-dot ann-" + o.dot }) : null,
          h("span", null, o.label), o.desc ? h("span", { class: "desc", title: o.desc }, o.desc) : null);
        flat.push(btn);
        box.append(btn);
      }
    }
    if (!flat.length) box.append(h("div", { class: "muted small", style: { padding: "6px 8px" } }, "Sin resultados"));
    focusIdx = Math.min(focusIdx, Math.max(0, flat.length - 1));
    flat.forEach((b, i) => b.classList.toggle("focus", i === focusIdx));
  };
  search.addEventListener("input", () => { focusIdx = 0; render(); });
  search.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); focusIdx = Math.min(flat.length - 1, focusIdx + 1); render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusIdx = Math.max(0, focusIdx - 1); render(); }
    else if (e.key === "Enter") { e.preventDefault(); if (flat[focusIdx]) flat[focusIdx].click(); }
  });
  render();
  return h("div", null, search, box);
}

// ------------------------------------------------------------------- varios
export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
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

export async function copyText(text) {
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
  toast("Copiado al portapapeles", "success", 1500);
}

export function downloadFile(filename, content, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function codeBlock(code) {
  return h("div", { class: "code-block" },
    h("button", { class: "btn sm ghost copy", type: "button", onclick: () => copyText(code) }, icon("copy"), "Copiar"),
    h("pre", null, code));
}

export function formatValue(v) {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function pct(v) {
  return Math.round((v || 0) * 100) + " %";
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
