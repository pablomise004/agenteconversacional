// Gráficos pequeños en SVG/HTML, sin librerías.
// Colores por rol (variables CSS --series-1, --series-2, --series-neg, --deemph,
// --grid, --axis), validados para fondo claro y oscuro. El texto nunca va en el
// color de la serie: identidad por la marca (punto, barra, línea) y su leyenda.
import { h, clear } from "./ui.js";

const SVG = "http://www.w3.org/2000/svg";

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

const nf = (digits = 0) => new Intl.NumberFormat("es-ES", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

function niceTicks(max, count = 4) {
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
function tooltip(container) {
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
export function divergingBars({ items, format = (v) => (v > 0 ? "+" : "") + nf(3).format(v), labelWidth = 160 }) {
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
    h("span", null, h("i", { class: "swatch", style: { background: "var(--series-1)" } }), "empuja hacia esta intención"),
    h("span", null, h("i", { class: "swatch", style: { background: "var(--series-neg)" } }), "le resta")));
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
export function heatmap({ labels, counts }) {
  const max = Math.max(1, ...counts.flat());
  const wrap = h("div", { class: "heatmap-wrap" });
  const tip = tooltip(wrap);
  const table = h("table", { class: "heatmap" });
  table.append(h("thead", null, h("tr", null, h("th", { class: "corner" }, "Real ↓ · Entendida →"),
    labels.map((l, j) => h("th", { title: l.name, scope: "col" }, String(j + 1))))));
  const body = h("tbody");
  labels.forEach((l, i) => {
    const tr = h("tr", null, h("th", { scope: "row", class: "row-label", title: l.name }, `${i + 1} · ${l.name}`));
    counts[i].forEach((c, j) => {
      const alpha = c ? 0.12 + 0.88 * (c / max) : 0;
      const td = h("td", { tabindex: c ? "0" : null, class: (i === j ? "diag" : "") + (c ? " has" : ""),
        style: { background: c ? `color-mix(in srgb, var(--series-1) ${Math.round(alpha * 100)}%, transparent)` : "" } },
      c ? String(c) : "");
      if (alpha > 0.55) td.classList.add("ink-light");
      const show = () => {
        const rb = td.getBoundingClientRect(), wb = wrap.getBoundingClientRect();
        tip.show(rb.left - wb.left + rb.width / 2 + wrap.scrollLeft, rb.top - wb.top,
          `${c} ${c === 1 ? "frase" : "frases"}`, i === j ? `«${l.name}» bien entendidas` : `de «${l.name}» entendidas como «${labels[j].name}»`);
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
