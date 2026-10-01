// Intérprete mínimo de Markdown para la guía (docs/GUIA.md). Construye el DOM
// con nodos (sin innerHTML). Soporta: encabezados, párrafos, listas (un nivel de
// anidación), tablas, bloques de código, citas (se muestran como avisos),
// imágenes, separadores y en línea **negrita**, *cursiva*, `código` y [enlaces](url).
import { h } from "./ui.js";

export function slug(text) {
  return "g-" + text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(!\[[^\]]*\]\([^)]+\))|(\[[^\]]+\]\([^)]+\))/g;

function inline(text, opts) {
  const out = [];
  let last = 0;
  let m;
  const re = new RegExp(INLINE.source, "g"); // una por llamada: inline() es recursiva
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (m[1]) out.push(h("code", null, tok.slice(1, -1)));
    else if (m[2]) out.push(h("strong", null, inline(tok.slice(2, -2), opts)));
    else if (m[3]) out.push(h("em", null, inline(tok.slice(1, -1), opts)));
    else if (m[4]) {
      const [, alt, src] = tok.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      out.push(h("img", { src: resolve(src, opts), alt, loading: "lazy" }));
    } else if (m[5]) {
      const [, label, href] = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      out.push(link(label, href, opts));
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function resolve(src, opts) {
  return /^(https?:|data:|\/)/.test(src) ? src : (opts.base || "") + src;
}

function link(label, href, opts) {
  if (href.startsWith("#") && !href.startsWith("#/")) {
    const id = slug(href.slice(1).replace(/-/g, " "));
    return h("a", { href: "#", onclick: (e) => {
      e.preventDefault();
      const target = document.getElementById(id) || document.getElementById("g-" + href.slice(1));
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    } }, inline(label, opts));
  }
  if (/^https?:/.test(href)) return h("a", { href, target: "_blank", rel: "noopener noreferrer" }, inline(label, opts));
  return h("a", { href: resolve(href, opts) }, inline(label, opts));
}

const LIST_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

export function renderMarkdown(md, opts = {}) {
  const root = h("div", { class: "md" });
  const headings = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  const isBlockStart = (l) => /^```/.test(l) || /^#{1,4}\s/.test(l) || /^>/.test(l) || LIST_RE.test(l) ||
    /^\s*\|/.test(l) || /^---+\s*$/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m = line.match(/^```(\w*)/);
    if (m) {
      const lang = m[1];
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      if (lang !== "mermaid") root.append(h("pre", { class: "md-code" }, h("code", null, buf.join("\n"))));
      continue;
    }
    m = line.match(/^(#{1,4})\s+(.*)$/);
    if (m) {
      const level = m[1].length;
      const text = m[2].trim();
      const id = slug(text);
      headings.push({ level, text, id });
      root.append(h("h" + level, { id }, inline(text, opts)));
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line)) { root.append(h("hr")); i++; continue; }
    if (line.startsWith(">")) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith(">")) buf.push(lines[i++].replace(/^>\s?/, ""));
      const inner = renderMarkdown(buf.join("\n"), opts).el;
      root.append(h("div", { class: "notice info md-note" }, h("div", null, [...inner.childNodes])));
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      root.append(h("div", { class: "table-wrap" }, h("table", { class: "table md-table" },
        h("thead", null, h("tr", null, head.map((c) => h("th", null, inline(c, opts))))),
        h("tbody", null, rows.map((r) => h("tr", null, r.map((c) => h("td", null, inline(c, opts)))))))));
      continue;
    }
    if (LIST_RE.test(line)) {
      const first = line.match(LIST_RE);
      const baseIndent = first[1].length;
      const ordered = /\d+\./.test(first[2]);
      const strip = baseIndent + first[2].length + 1; // sangría del contenido de cada elemento
      const list = h(ordered ? "ol" : "ul");
      if (ordered && parseInt(first[2], 10) !== 1) list.setAttribute("start", parseInt(first[2], 10));
      const sibling = (l) => {
        const lm = l.match(LIST_RE);
        return lm && lm[1].length <= baseIndent + 1 && /\d+\./.test(lm[2]) === ordered ? lm : null;
      };
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        const lm = sibling(l);
        if (lm) { items.push([lm[3]]); i++; continue; }
        if (!items.length) break;
        const indent = l.match(/^\s*/)[0].length;
        if (!l.trim()) {
          // una línea en blanco sigue dentro de la lista si lo siguiente está sangrado o es otro elemento
          let k = i + 1;
          while (k < lines.length && !lines[k].trim()) k++;
          const next = lines[k] || "";
          if (k < lines.length && (sibling(next) || next.match(/^\s*/)[0].length > baseIndent + 1)) {
            items[items.length - 1].push("");
            i++;
            continue;
          }
          break;
        }
        if (indent > baseIndent) { items[items.length - 1].push(l.slice(Math.min(indent, strip))); i++; continue; }
        break;
      }
      for (const itemLines of items) {
        while (itemLines.length && !itemLines[itemLines.length - 1].trim()) itemLines.pop();
        const inner = renderMarkdown(itemLines.join("\n"), opts).el;
        const nodes = [...inner.childNodes];
        // lista compacta: un único párrafo se muestra sin margen
        list.append(h("li", null, nodes.length === 1 && nodes[0].tagName === "P" ? [...nodes[0].childNodes] : nodes));
      }
      root.append(list);
      continue;
    }
    const buf = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) buf.push(lines[i++].trim());
    root.append(h("p", null, inline(buf.join(" "), opts)));
  }
  return { el: root, headings };
}
