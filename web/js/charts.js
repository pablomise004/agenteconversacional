// Gráficos pequeños en SVG/HTML, sin librerías.
// Colores por rol (variables CSS --series-1, --series-2, --series-neg, --deemph,
// --grid, --axis), validados para fondo claro y oscuro. El texto nunca va en el
// color de la serie: identidad por la marca (punto, barra, línea) y su leyenda.
import { h, clear } from "./ui.js";

const SVG = "http://www.w3.org/2000/svg";

export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, String(v));  // null: sin atributos, como en h()
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export const nf = (digits = 0) => new Intl.NumberFormat("es-ES", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => st >= raw) || raw;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(+v.toFixed(10));
  if (ticks[ticks.length - 1] < max) ticks.push(+(ticks[ticks.length - 1] + step).toFixed(10));
  return ticks;
}

// Tooltip compartido dentro de un contenedor con position:relative
export function tooltip(container) {
  const tip = h("div", { class: "chart-tip", role: "status" });
  container.append(tip);
  return {
    show(x, y, value, label) {
      clear(tip).append(h("b", null, value), label ? h("span", null, label) : null);
      tip.style.display = "block";
      const cw = container.clientWidth;
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(cw - tw, x - tw / 2)) + "px";
      tip.style.top = Math.max(0, y - tip.offsetHeight - 10) + "px";
    },
    hide() { tip.style.display = "none"; },
  };
}

/**
 * Línea de una sola serie (la curva de aprendizaje). setProgress(n) dibuja solo
 * los n primeros puntos: así se anima época a época.
 */
export function lineChart({ data, yMax, yFormat = (v) => nf(2).format(v), xLabel = "", label = "", width = 420, height = 170 }) {
  const m = { l: 40, r: 14, t: 10, b: 30 };
  const iw = width - m.l - m.r, ih = height - m.t - m.b;
  const xs = data.map((d) => d.x);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const top = yMax ?? Math.max(...data.map((d) => d.y)) * 1.05;
  const ticks = niceTicks(top, 3);
  const yTop = ticks[ticks.length - 1] || 1;
  const X = (v) => m.l + (xMax === xMin ? 0 : ((v - xMin) / (xMax - xMin)) * iw);
  const Y = (v) => m.t + ih - (v / yTop) * ih;
  const svg = s("svg", { viewBox: `0 0 ${width} ${height}`, class: "chart-svg", role: "img", "aria-label": label });
  for (const t of ticks) {
    svg.append(s("line", { x1: m.l, x2: m.l + iw, y1: Y(t), y2: Y(t), class: t === 0 ? "axis" : "grid" }));
    svg.append(s("text", { x: m.l - 6, y: Y(t) + 4, "text-anchor": "end", class: "tick" }, yFormat(t)));
  }
  const xTicks = data.length > 8 ? data.filter((d, i) => i % Math.ceil(data.length / 6) === 0 || i === data.length - 1) : data;
  for (const d of xTicks) svg.append(s("text", { x: X(d.x), y: height - 10, "text-anchor": "middle", class: "tick" }, d.x));
  const area = s("path", { class: "area" });
  const line = s("path", { class: "line", pathLength: 1 }); // pathLength: la línea se dibuja al aparecer (CSS)
  const dot = s("circle", { r: 4, class: "end-dot" });
  const cross = s("line", { y1: m.t, y2: m.t + ih, class: "crosshair", visibility: "hidden" });
  const hoverDot = s("circle", { r: 4, class: "end-dot", visibility: "hidden" });
  svg.append(area, line, cross, dot, hoverDot);
  let shown = data.length;
  const draw = () => {
    const pts = data.slice(0, Math.max(1, shown));
    const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
    line.setAttribute("d", d);
    area.setAttribute("d", `${d}L${X(pts[pts.length - 1].x).toFixed(1)},${Y(0)}L${X(pts[0].x).toFixed(1)},${Y(0)}Z`);
    const last = pts[pts.length - 1];
    dot.setAttribute("cx", X(last.x));
    dot.setAttribute("cy", Y(last.y));
  };
  draw();
  const box = h("div", { class: "chart" }, svg);
  const tip = tooltip(box);
  const overlay = s("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent" });
  svg.append(overlay);
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * width;
    const pts = data.slice(0, shown);
    let best = pts[0];
    for (const p of pts) if (Math.abs(X(p.x) - px) < Math.abs(X(best.x) - px)) best = p;
    cross.setAttribute("x1", X(best.x));
    cross.setAttribute("x2", X(best.x));
    cross.setAttribute("visibility", "visible");
    hoverDot.setAttribute("cx", X(best.x));
    hoverDot.setAttribute("cy", Y(best.y));
    hoverDot.setAttribute("visibility", "visible");
    const scale = r.width / width;
    tip.show(X(best.x) * scale, Y(best.y) * scale, yFormat(best.y), `${xLabel} ${best.x}`);
  };
  overlay.addEventListener("pointermove", move);
  overlay.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    hoverDot.setAttribute("visibility", "hidden");
    tip.hide();
  });
  box.setProgress = (n) => { shown = Math.max(1, Math.min(data.length, n)); draw(); };
  return box;
}

/** Barras horizontales de una sola serie (magnitudes positivas). */
export function barList({ items, max, format = (v) => nf(2).format(v), color = "var(--series-1)", labelWidth = 150, empty = "Sin datos" }) {
  const box = h("div", { class: "bars" });
  if (!items.length) return h("div", { class: "muted small" }, empty);
  const top = max ?? Math.max(...items.map((i) => i.value), 1e-9);
  const tip = tooltip(box);
  for (const it of items) {
    const pct = Math.max(0, Math.min(1, it.value / top)) * 100;
    const bar = h("div", { class: "bar", style: { width: pct + "%", background: color } });
    const row = h("div", { class: "bar-row", tabindex: "0", style: { gridTemplateColumns: `${labelWidth}px 1fr` } },
      h("div", { class: "bar-label", title: it.title || it.label }, it.label, it.sub ? h("span", { class: "faint" }, " " + it.sub) : null),
      h("div", { class: "bar-track" }, bar));
    const show = () => {
      const rb = row.getBoundingClientRect(), bb = box.getBoundingClientRect(), barRect = bar.getBoundingClientRect();
      tip.show(barRect.right - bb.left, rb.top - bb.top, format(it.value), it.tip || it.label);
    };
    row.addEventListener("pointerenter", show);
    row.addEventListener("focus", show);
    row.addEventListener("pointerleave", () => tip.hide());
    row.addEventListener("blur", () => tip.hide());
    box.append(row);
  }
  return box;
}

/** Barras divergentes: lo que suma (azul) a la derecha y lo que resta (rojo) a la izquierda. */
export function divergingBars({ items, format = (v) => (v > 0 ? "+" : "") + nf(3).format(v), labelWidth = 160,
  legend = ["empuja hacia esta intención", "le resta"] }) {
  const box = h("div", { class: "bars diverging" });
  if (!items.length) return h("div", { class: "muted small" }, "Sin datos");
  const top = Math.max(...items.map((i) => Math.abs(i.value)), 1e-9);
  const tip = tooltip(box);
  for (const it of items) {
    const w = (Math.abs(it.value) / top) * 50;
    const pos = it.value >= 0;
    const bar = h("div", { class: "dbar " + (pos ? "pos" : "neg"), style: pos ? { left: "50%", width: w + "%" } : { right: "50%", width: w + "%" } });
    const row = h("div", { class: "bar-row", tabindex: "0", style: { gridTemplateColumns: `${labelWidth}px 1fr` } },
      h("div", { class: "bar-label", title: it.title || it.label }, it.label, it.sub ? h("span", { class: "faint" }, " " + it.sub) : null),
      h("div", { class: "bar-track dtrack" }, h("div", { class: "zero" }), bar));
    const show = () => {
      const rb = row.getBoundingClientRect(), bb = box.getBoundingClientRect(), r = bar.getBoundingClientRect();
      tip.show((pos ? r.right : r.left) - bb.left, rb.top - bb.top, format(it.value), it.tip || it.label);
    };
    row.addEventListener("pointerenter", show);
    row.addEventListener("focus", show);
    row.addEventListener("pointerleave", () => tip.hide());
    row.addEventListener("blur", () => tip.hide());
    box.append(row);
  }
  box.append(h("div", { class: "legend" },
    h("span", null, h("i", { class: "swatch", style: { background: "var(--series-1)" } }), legend[0]),
    h("span", null, h("i", { class: "swatch", style: { background: "var(--series-neg)" } }), legend[1])));
  return box;
}

/**
 * Mapa de puntos con énfasis: todas las frases en gris y como mucho dos
 * intenciones resaltadas (azul y naranja). probe = la frase que se explica.
 */
export function scatter({ points, a, b, names = {}, probe, width = 640, height = 400 }) {
  const pad = 18;
  const X = (v) => pad + v * (width - 2 * pad);
  const Y = (v) => pad + (1 - v) * (height - 2 * pad);
  const svg = s("svg", { viewBox: `0 0 ${width} ${height}`, class: "chart-svg scatter", role: "img",
    "aria-label": "Mapa de frases de entrenamiento" });
  svg.append(s("rect", { x: 0.5, y: 0.5, width: width - 1, height: height - 1, rx: 8, class: "plot-frame" }));
  const order = [...points].sort((p, q) => rank(p) - rank(q));
  function rank(p) { return p.intentId === a ? 2 : p.intentId === b ? 1 : 0; }
  const pts = s("g", { class: "pts" });
  for (const p of order) {
    const cls = p.intentId === a ? "pt a" : p.intentId === b ? "pt b" : "pt";
    pts.append(s("circle", { cx: X(p.x), cy: Y(p.y), r: p.intentId === a || p.intentId === b ? 5 : 4, class: cls }));
  }
  svg.append(pts);
  if (probe) {
    svg.append(s("circle", { cx: X(probe.x), cy: Y(probe.y), r: 9, class: "probe-ring" }));
    svg.append(s("circle", { cx: X(probe.x), cy: Y(probe.y), r: 3, class: "probe-dot" }));
    svg.append(s("text", { x: X(probe.x) + 13, y: Y(probe.y) + 4, class: "probe-label" }, "tu frase"));
  }
  const hover = s("circle", { r: 7, class: "pt-hover", visibility: "hidden" });
  svg.append(hover);
  const box = h("div", { class: "chart" }, svg);
  const tip = tooltip(box);
  svg.addEventListener("pointermove", (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * width, py = ((ev.clientY - r.top) / r.height) * height;
    let best = null, bd = Infinity;
    for (const p of points) {
      const d = (X(p.x) - px) ** 2 + (Y(p.y) - py) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    if (!best || bd > 24 * 24) { hover.setAttribute("visibility", "hidden"); tip.hide(); return; }
    hover.setAttribute("cx", X(best.x));
    hover.setAttribute("cy", Y(best.y));
    hover.setAttribute("visibility", "visible");
    const scale = r.width / width;
    tip.show(X(best.x) * scale, Y(best.y) * scale, "“" + best.text + "”", best.intentName);
  });
  svg.addEventListener("pointerleave", () => { hover.setAttribute("visibility", "hidden"); tip.hide(); });
  const legend = h("div", { class: "legend" });
  if (a) legend.append(h("span", null, h("i", { class: "swatch dot", style: { background: "var(--series-1)" } }), names[a] || a));
  if (b) legend.append(h("span", null, h("i", { class: "swatch dot", style: { background: "var(--series-2)" } }), names[b] || b));
  legend.append(h("span", null, h("i", { class: "swatch dot", style: { background: "var(--deemph)" } }), "otras intenciones"));
  if (probe) legend.append(h("span", null, h("i", { class: "swatch ring" }), "tu frase (posición aproximada)"));
  box.append(legend);
  return box;
}

/** Matriz de confusión: filas = intención real, columnas = lo que entendió. */
/**
 * Matriz de confusión: cada fila es la intención real y cada columna lo que entendió. Azul, la
 * diagonal (bien entendidas); naranja, las confusiones (cada color con su propio máximo, para que
 * se vean aunque sean pocas). Hasta 24 intenciones es una tabla con el número en cada casilla;
 * con más, un mapa compacto en SVG que cabe a lo ancho, sin números: grupos por prefijo
 * («reserva», «charla»…) y el detalle al pasar el ratón o con las flechas.
 */
// las palabras de la matriz: de frases e intenciones (por defecto) o de filas y clases (machine learning)
const HEAT_WORDS = { one: "frase", many: "frases", ok: "bien entendidas", as: "entendidas como", corner: "Real ↓ · Entendida →",
  items: "intenciones" };
export const HEAT_WORDS_ML = { one: "fila", many: "filas", ok: "bien clasificadas", as: "clasificadas como", corner: "Real ↓ · Predicha →",
  items: "clases" };

export function heatmap({ labels, counts, words = HEAT_WORDS }) {
  const n = labels.length;
  labels = labels.map((l) => (typeof l === "string" ? { name: l } : l));
  const wrap = n > 24 ? heatmapCompact(labels, counts, words) : heatmapTable(labels, counts, words);
  return h("div", null, wrap, h("div", { class: "heatmap-legend small muted" },
    h("span", { class: "legend-key a" }), `${words.ok} (la diagonal)`,
    h("span", { class: "legend-key b" }), "confusiones",
    n > 24 ? h("span", { class: "faint" }, " · pasa el ratón (o usa las flechas) para ver cada casilla") : null));
}

// intensidad de cada casilla: los aciertos y las confusiones se escalan por separado
function heatAlpha(counts) {
  let diag = 1, off = 1;
  counts.forEach((row, i) => row.forEach((c, j) => {
    if (i === j) diag = Math.max(diag, c);
    else off = Math.max(off, c);
  }));
  // raíz cuadrada: los valores medios se ven (con 60 aciertos en una fila, 10 no quedarían pálidos)
  return (c, i, j) => (c ? 0.22 + 0.78 * Math.sqrt(c / (i === j ? diag : off)) : 0);
}

const cellText = (labels, i, j, c, w) => [`${c} ${c === 1 ? w.one : w.many}`,
  i === j ? `«${labels[i].name}» ${w.ok}` : `de «${labels[i].name}» ${w.as} «${labels[j].name}»`];

function heatmapTable(labels, counts, words) {
  const alpha = heatAlpha(counts);
  const wrap = h("div", { class: "heatmap-wrap" });
  const tip = tooltip(wrap);
  const table = h("table", { class: "heatmap" });
  table.append(h("thead", null, h("tr", null, h("th", { class: "corner" }, words.corner),
    labels.map((l, j) => h("th", { title: l.name, scope: "col" }, String(j + 1))))));
  const body = h("tbody");
  labels.forEach((l, i) => {
    const tr = h("tr", null, h("th", { scope: "row", class: "row-label", title: l.name }, `${i + 1} · ${l.name}`));
    counts[i].forEach((c, j) => {
      const a = alpha(c, i, j);
      // el número va en negro sobre el naranja (en blanco no se lee): intensidad hasta el 55 %
      const pct = Math.round((i === j ? a : Math.min(a, 0.55)) * 100);
      const td = h("td", { tabindex: c ? "0" : null, class: (i === j ? "diag" : "") + (c ? " has" : ""),
        style: { background: c ? `color-mix(in srgb, var(${i === j ? "--series-1" : "--series-2"}) ${pct}%, transparent)` : "" } },
      c ? String(c) : "");
      if (i === j && a > 0.55) td.classList.add("ink-light");
      const show = () => {
        const rb = td.getBoundingClientRect(), wb = wrap.getBoundingClientRect();
        tip.show(rb.left - wb.left + rb.width / 2 + wrap.scrollLeft, rb.top - wb.top, ...cellText(labels, i, j, c, words));
      };
      if (c) {
        td.addEventListener("pointerenter", show);
        td.addEventListener("focus", show);
        td.addEventListener("pointerleave", () => tip.hide());
        td.addEventListener("blur", () => tip.hide());
      }
      tr.append(td);
    });
    body.append(tr);
  });
  table.append(body);
  wrap.append(table);
  return wrap;
}

let heatmapIds = 0;

function heatmapCompact(labels, counts, words) {
  const n = labels.length;
  const alpha = heatAlpha(counts);
  const W = 880, LW = 116, TOP = 2;  // medidas en unidades del viewBox (≈ píxeles a 880 de ancho)
  const c = (W - LW) / n;            // lado de cada casilla
  const X = (j) => LW + j * c, Y = (i) => TOP + i * c;
  const wrap = h("div", { class: "heatmap-wrap" });
  const tip = tooltip(wrap);
  const svg = s("svg", { viewBox: `0 0 ${W} ${TOP + n * c + 2}`, class: "heatmap-svg", role: "img", tabindex: "0",
    "aria-label": `Matriz de confusión de ${n} ${words.items}; con las flechas se recorren sus casillas` });
  // casillas vacías: un patrón en vez de miles de rectángulos
  const pid = `hm${++heatmapIds}`;
  const tile = (x, y, cls, extra = {}) => s("rect", { x: x + c * 0.08, y: y + c * 0.08, width: c * 0.84, height: c * 0.84,
    rx: c * 0.2, class: cls, ...extra });
  svg.append(s("defs", {}, s("pattern", { id: pid, x: LW, y: TOP, width: c, height: c, patternUnits: "userSpaceOnUse" },
    tile(0, 0, "hm-empty"))), s("rect", { x: LW, y: TOP, width: n * c, height: n * c, fill: `url(#${pid})` }));
  const rowBand = s("rect", { class: "hm-band", x: LW, width: n * c, height: c, visibility: "hidden" });
  const colBand = s("rect", { class: "hm-band", y: TOP, width: c, height: n * c, visibility: "hidden" });
  svg.append(rowBand, colBand);
  // grupos por prefijo («reserva.habitacion» → «reserva»): líneas entre ellos y su nombre a la izquierda
  const group = (name) => (name.includes(".") ? name.slice(0, name.indexOf(".")) : name);
  let start = 0;
  for (let i = 1; i <= n; i++) {
    if (i < n && group(labels[i].name) === group(labels[start].name)) continue;
    if (start > 0) {
      svg.append(s("line", { class: "hm-sep", x1: LW, x2: LW + n * c, y1: Y(start), y2: Y(start) }),
        s("line", { class: "hm-sep", x1: X(start), x2: X(start), y1: TOP, y2: TOP + n * c }));
    }
    const last = labels[start].id === "__fallback__";
    if (i - start >= 2 || last) {
      svg.append(s("text", { class: "hm-group", x: LW - 8, y: Y(start) + ((i - start) * c) / 2 },
        last ? "no entendida" : group(labels[start].name)));
    }
    start = i;
  }
  counts.forEach((row, i) => row.forEach((v, j) => {
    if (v) svg.append(tile(X(j), Y(i), "hm-cell " + (i === j ? "diag" : "off"), { "fill-opacity": alpha(v, i, j).toFixed(3) }));
  }));
  const focusBox = s("rect", { class: "hm-focus", width: c, height: c, rx: c * 0.24, visibility: "hidden" });
  const hit = s("rect", { x: LW, y: TOP, width: n * c, height: n * c, fill: "transparent" });
  svg.append(focusBox, hit);
  wrap.append(svg);

  let cur = null;
  const show = (i, j) => {
    cur = [i, j];
    rowBand.setAttribute("y", Y(i));
    colBand.setAttribute("x", X(j));
    focusBox.setAttribute("x", X(j));
    focusBox.setAttribute("y", Y(i));
    for (const el of [rowBand, colBand, focusBox]) el.setAttribute("visibility", "visible");
    const sb = svg.getBoundingClientRect(), wb = wrap.getBoundingClientRect(), k = sb.width / W;
    tip.show(sb.left - wb.left + (X(j) + c / 2) * k + wrap.scrollLeft, sb.top - wb.top + Y(i) * k,
      ...cellText(labels, i, j, counts[i][j], words));
  };
  const hide = () => {
    cur = null;
    for (const el of [rowBand, colBand, focusBox]) el.setAttribute("visibility", "hidden");
    tip.hide();
  };
  hit.addEventListener("pointermove", (e) => {
    const sb = svg.getBoundingClientRect(), k = sb.width / W;
    const i = Math.floor(((e.clientY - sb.top) / k - TOP) / c), j = Math.floor(((e.clientX - sb.left) / k - LW) / c);
    if (i >= 0 && i < n && j >= 0 && j < n && (!cur || cur[0] !== i || cur[1] !== j)) show(i, j);
  });
  hit.addEventListener("pointerleave", hide);
  svg.addEventListener("blur", hide);
  svg.addEventListener("keydown", (e) => {
    const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    const [i, j] = cur ? [cur[0] + d[0], cur[1] + d[1]] : [0, 0];
    show(Math.max(0, Math.min(n - 1, i)), Math.max(0, Math.min(n - 1, j)));
  });
  return wrap;
}

/** Medidor de confianza frente al umbral, con estado en texto e icono (no solo color). */
export function meter({ value, threshold, label = "Confianza" }) {
  const ok = value >= threshold;
  return h("div", { class: "meter-box" },
    h("div", { class: "row" }, h("span", { class: "muted small" }, label), h("span", { class: "spacer" }),
      h("b", null, Math.round(value * 100) + " %"), h("span", { class: "muted small" }, ` · umbral ${Math.round(threshold * 100)} %`)),
    h("div", { class: "meter" },
      h("div", { class: "meter-fill", style: { width: Math.round(Math.max(0, Math.min(1, value)) * 100) + "%" } }),
      h("div", { class: "meter-thr", style: { left: Math.round(threshold * 100) + "%" }, title: "Umbral" })),
    h("div", { class: "status" }, h("span", { class: "status-icon " + (ok ? "good" : "critical") }, ok ? "✓" : "✗"),
      ok ? "Por encima del umbral: responde esta intención" : "Por debajo del umbral: respondería el fallback («no te he entendido»)"));
}

/**
 * Columnas verticales de una sola serie (actividad por día).
 * data: [{ x: etiqueta corta del eje, value, title: título del tooltip, tip?: texto extra }]
 */
export function columnChart({ data, label = "", yFormat = (v) => nf(0).format(v), every = 7, width = 440, height = 180 }) {
  const m = { l: 34, r: 6, t: 10, b: 26 };
  const iw = width - m.l - m.r, ih = height - m.t - m.b;
  const ticks = niceTicks(Math.max(1, ...data.map((d) => d.value)), 3);
  const yTop = ticks[ticks.length - 1] || 1;
  const Y = (v) => m.t + ih - (v / yTop) * ih;
  const bw = iw / Math.max(1, data.length);
  const svg = s("svg", { viewBox: `0 0 ${width} ${height}`, class: "chart-svg columns", role: "img", "aria-label": label });
  for (const t of ticks) {
    svg.append(s("line", { x1: m.l, x2: m.l + iw, y1: Y(t), y2: Y(t), class: t === 0 ? "axis" : "grid" }));
    svg.append(s("text", { x: m.l - 6, y: Y(t) + 4, "text-anchor": "end", class: "tick" }, yFormat(t)));
  }
  const bars = data.map((d, i) => {
    const w = Math.max(2, bw * 0.62), x = m.l + i * bw + (bw - w) / 2;
    const ht = d.value ? Math.max(2, (d.value / yTop) * ih) : 0;
    const bar = s("rect", { x, y: m.t + ih - ht, width: w, height: ht, rx: Math.min(3, w / 2), class: "col-bar",
      style: `animation-delay:${Math.min(i, 40) * 14}ms` });
    svg.append(bar);
    if ((data.length - 1 - i) % every === 0) { // la última columna (hoy) siempre lleva fecha
      svg.append(s("text", { x: x + w / 2, y: height - 8, "text-anchor": "middle", class: "tick" }, d.x));
    }
    return { bar, cx: x + w / 2, top: m.t + ih - ht };
  });
  const box = h("div", { class: "chart" }, svg);
  const tip = tooltip(box);
  const overlay = s("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent" });
  svg.append(overlay);
  let hot = -1;
  overlay.addEventListener("pointermove", (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * width;
    const i = Math.max(0, Math.min(data.length - 1, Math.floor((px - m.l) / bw)));
    if (i !== hot) {
      if (hot >= 0) bars[hot].bar.classList.remove("hot");
      bars[i].bar.classList.add("hot");
      hot = i;
    }
    const scale = r.width / width;
    tip.show(bars[i].cx * scale, Math.min(bars[i].top, m.t + ih - 4) * scale, data[i].title, data[i].tip || "");
  });
  overlay.addEventListener("pointerleave", () => {
    if (hot >= 0) bars[hot].bar.classList.remove("hot");
    hot = -1;
    tip.hide();
  });
  return box;
}

export const format = { nf };
