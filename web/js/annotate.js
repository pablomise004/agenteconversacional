// Frase con anotaciones de entidades: seleccionar texto -> elegir entidad.
import { h, icon, clear, popover, closePopover, optionList } from "./ui.js";

const WORD = /[\p{L}\p{N}_'’@.:\/€%$\-]/u;

function offsetOf(root, node, offset) {
  const r = document.createRange();
  r.setStart(root, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

export function defaultParamName(entity) {
  let name = (entity || "").replace(/^@/, "");
  if (name.startsWith("sys.")) name = name.slice(4);
  return name.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "param";
}

// Propone un nombre de parámetro para una entidad, reutilizando los existentes
export function suggestParam(entity, params, usedInPhrase = []) {
  const same = params.filter((p) => p.entity === entity).map((p) => p.name);
  const free = same.find((n) => !usedInPhrase.includes(n));
  if (free) return free;
  const base = defaultParamName(entity);
  let name = base, n = 1;
  const taken = new Set([...params.map((p) => p.name), ...usedInPhrase]);
  while (taken.has(name)) name = base + ++n;
  return name;
}

export function entityGroups({ params = [], entities = [], systemEntities = [], colorOf }) {
  const groups = [];
  if (params.length) {
    groups.push({
      title: "Parámetros de la intención",
      options: params.filter((p) => p.entity).map((p) => ({
        label: `${p.name}`, desc: p.entity, value: { entity: p.entity, param: p.name }, dot: colorOf ? colorOf(p.name) : null,
      })),
    });
  }
  groups.push({
    title: "Entidades del agente",
    options: entities.map((e) => ({ label: "@" + e.name, desc: `${e.entries.length} valores`, value: { entity: "@" + e.name } })),
  });
  groups.push({
    title: "Entidades del sistema",
    options: systemEntities.map((e) => ({ label: e.name, desc: e.description, value: { entity: e.name } })),
  });
  return groups;
}

/**
 * opts: text, annotations, getParams() -> parámetros de la intención,
 *       getEntities(), systemEntities, colorOf(param) -> índice de color,
 *       onChange(annotations), readOnly, onEditText()
 */
export function annotatedPhrase(opts) {
  let annotations = (opts.annotations || []).map((a) => ({ ...a })).sort((a, b) => a.start - b.start);
  const text = opts.text;
  const el = h("div", { class: "phrase", tabindex: opts.readOnly ? null : "0", title: opts.readOnly ? null : "Selecciona una palabra para anotarla como entidad" });

  const render = () => {
    clear(el);
    let pos = 0;
    for (const a of annotations) {
      if (a.start > pos) el.append(document.createTextNode(text.slice(pos, a.start)));
      const color = opts.colorOf ? opts.colorOf(a.param, a.entity) : 0;
      const span = h("span", { class: "ann ann-" + color, title: `${a.entity} · ${a.param}` }, text.slice(a.start, a.end));
      if (!opts.readOnly) span.addEventListener("click", (e) => { e.stopPropagation(); annMenu(a, span); });
      el.append(span);
      pos = a.end;
    }
    if (pos < text.length) el.append(document.createTextNode(text.slice(pos)));
  };

  const changed = () => {
    annotations.sort((a, b) => a.start - b.start);
    render();
    if (opts.onChange) opts.onChange(annotations.map((a) => ({ ...a })));
  };

  const addAnnotation = (start, end, entity, param) => {
    annotations = annotations.filter((a) => a.end <= start || a.start >= end);
    const used = annotations.map((a) => a.param);
    if (!param) param = suggestParam(entity, opts.getParams ? opts.getParams() : [], used);
    annotations.push({ start, end, entity, param });
    changed();
  };

  const entityMenu = (start, end, rect) => {
    const groups = entityGroups({
      params: opts.getParams ? opts.getParams() : [],
      entities: opts.getEntities ? opts.getEntities() : [],
      systemEntities: opts.systemEntities || [],
      colorOf: opts.colorOf,
    });
    const content = h("div", null,
      h("div", { class: "pop-head" }, "«", text.slice(start, end), "» es…"),
      optionList({
        groups,
        placeholder: "Buscar entidad…",
        onPick: (v) => { closePopover(); addAnnotation(start, end, v.entity, v.param); },
      }));
    popover(rect, content);
  };

  const annMenu = (a, anchor) => {
    const paramInput = h("input", { type: "text", value: a.param, "aria-label": "Nombre del parámetro" });
    const apply = () => {
      const v = paramInput.value.trim().replace(/[^\w-]+/g, "_");
      if (v && v !== a.param) { a.param = v; changed(); }
    };
    paramInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); apply(); closePopover(); } });
    const content = h("div", { class: "col", style: { padding: "4px" } },
      h("div", { class: "pop-head" }, "«", text.slice(a.start, a.end), "»"),
      h("div", { class: "small muted", style: { padding: "0 8px" } }, "Entidad: ", h("b", null, a.entity)),
      h("label", { class: "field", style: { padding: "0 8px" } }, "Parámetro", paramInput),
      h("div", { class: "row", style: { padding: "4px 8px" } },
        h("button", { class: "btn sm", type: "button", onclick: () => { apply(); closePopover(); entityMenu(a.start, a.end, anchor.getBoundingClientRect()); } }, "Cambiar entidad"),
        h("span", { class: "spacer" }),
        h("button", { class: "btn sm danger", type: "button", onclick: () => {
          closePopover();
          annotations = annotations.filter((x) => x !== a);
          changed();
        } }, icon("trash"), "Quitar")));
    popover(anchor, content, { onClose: apply });
  };

  if (!opts.readOnly) {
    el.addEventListener("mouseup", () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return;
      let start = offsetOf(el, range.startContainer, range.startOffset);
      let end = offsetOf(el, range.endContainer, range.endOffset);
      if (start > end) [start, end] = [end, start];
      // ajustar a palabras completas, como Dialogflow
      while (start > 0 && WORD.test(text[start - 1]) && WORD.test(text[start])) start--;
      while (end < text.length && WORD.test(text[end - 1] || "") && WORD.test(text[end])) end++;
      while (start < end && /[\s¿?¡!,;:]/.test(text[start])) start++;
      while (end > start && /[\s¿?¡!,;:.]/.test(text[end - 1])) end--;
      if (end <= start) return;
      const rect = range.getBoundingClientRect();
      sel.removeAllRanges();
      entityMenu(start, end, rect);
    });
    if (opts.onEditText) el.addEventListener("dblclick", (e) => {
      if (e.target === el) opts.onEditText();
    });
  }
  render();
  el.getAnnotations = () => annotations.map((a) => ({ ...a }));
  el.setAnnotations = (anns) => { annotations = anns.map((a) => ({ ...a })); render(); };
  return el;
}

// Asigna colores estables a los parámetros de una intención
export function colorMap(params) {
  const map = new Map();
  (params || []).forEach((p, i) => map.set(p.name, i % 8));
  return (param, entity) => {
    if (map.has(param)) return map.get(param);
    let hsh = 0;
    for (const c of param || entity || "") hsh = (hsh * 31 + c.charCodeAt(0)) >>> 0;
    return hsh % 8;
  };
}
