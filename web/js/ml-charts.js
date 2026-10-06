// Gráficos de la parte de machine learning (SVG/HTML, sin librerías), con las mismas reglas que charts.js:
// marcas finas, una sola escala por gráfico, el texto nunca en el color de la serie, leyenda con dos o más
// series y tooltip al pasar el ratón. Colores: --series-1/2/3 (validados para daltonismo de tres en tres)
// y --deemph para lo que no se resalta.
import { h, clear } from "./ui.js";
import { columnChart, nf, s, tooltip } from "./charts.js";

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];

// marcas de un eje para cualquier rango (también negativo): de 3 a 6 valores redondos
function ticks(lo, hi, count = 5) {
  if (!(hi > lo)) { hi = lo + 1; lo -= 1; }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => st >= raw) || raw;
  // de la marca redonda de debajo de lo más bajo a la de encima de lo más alto (antes la última podía quedarse
  // corta y los puntos más altos se salían del gráfico)
  const out = [+(Math.floor(lo / step) * step).toFixed(10)];
  while (out[out.length - 1] < hi - step * 1e-9) out.push(+(out[out.length - 1] + step).toFixed(10));
  if (out.length < 2) out.push(+(out[0] + step).toFixed(10));
  return out;
}

export const fmt = (v, digits = 2) => (v == null || !isFinite(v) ? "—" : nf(digits).format(v));
const compact = (v) => (Math.abs(v) >= 10000 ? nf(0).format(v / 1000) + " mil" : nf(Math.abs(v) < 10 ? 2 : 0).format(v));
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
// «2011-05-02» → «may 2011» (o «2 may» si todas caen en pocos meses)
function shortDate(iso, long) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!m) return String(iso);
  return long ? `${MONTHS[m - 1]} ${y}` : `${d || 1} ${MONTHS[m - 1]}`;
}

/** Histograma de una columna de números (o barras por valor si son pocos enteros). */
export function histogram(profile, { label = "" } = {}) {
  if (profile.bars) {
    return columnChart({ data: profile.bars.map((b) => ({ x: b.value, value: b.count, title: `${b.value}: ${b.count} filas` })),
      label, every: Math.max(1, Math.ceil(profile.bars.length / 8)), width: 300, height: 120 });
  }
  if (!profile.hist) return null;
  const { edges, counts } = profile.hist;
  const isDate = typeof edges[0] === "string";
  const show = (v) => (isDate ? v : compact(v));
  // en el eje, las fechas cortas («may 2011»): enteras («2011-05-02») no caben y se pisan; enteras en el tooltip
  const days = isDate ? (Date.parse(edges[edges.length - 1]) - Date.parse(edges[0])) / 864e5 : 0;
  const axis = (v) => (isDate ? shortDate(v, days > 75) : compact(v));
  const data = counts.map((c, i) => ({ x: axis(edges[i]), value: c, title: `${c} filas`, tip: `de ${show(edges[i])} a ${show(edges[i + 1])}` }));
  return columnChart({ data, label, every: Math.max(1, Math.ceil(data.length / 4)), width: 300, height: 120 });
}

/**
 * Puntos con dos ejes numéricos (lo real frente a lo predicho). Con `diagonal`, la recta y = x de la
 * predicción perfecta y los dos ejes con la misma escala.
 */
export function xyScatter({ points, xLabel = "", yLabel = "", diagonal = false, digits = 1, width = 560, height = 360, label = "" }) {
  const m = { l: 56, r: 16, t: 14, b: 44 };
  const iw = width - m.l - m.r, ih = height - m.t - m.b;
  let xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  let [x0, x1] = [Math.min(...xs), Math.max(...xs)], [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  if (diagonal) { x0 = y0 = Math.min(x0, y0); x1 = y1 = Math.max(x1, y1); }
  const tx = ticks(x0, x1, 5), ty = ticks(y0, y1, 5);
  [x0, x1] = [tx[0], tx[tx.length - 1]];
  [y0, y1] = [ty[0], ty[ty.length - 1]];
  const X = (v) => m.l + ((v - x0) / (x1 - x0 || 1)) * iw;
  const Y = (v) => m.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih;
  const svg = s("svg", { viewBox: `0 0 ${width} ${height}`, class: "chart-svg xy", role: "img", "aria-label": label || `${yLabel} frente a ${xLabel}` });
  for (const t of ty) {
    svg.append(s("line", { x1: m.l, x2: m.l + iw, y1: Y(t), y2: Y(t), class: "grid" }));
    svg.append(s("text", { x: m.l - 6, y: Y(t) + 4, "text-anchor": "end", class: "tick" }, compact(t)));
  }
  for (const t of tx) {
    svg.append(s("line", { x1: X(t), x2: X(t), y1: m.t, y2: m.t + ih, class: "grid" }));
    svg.append(s("text", { x: X(t), y: m.t + ih + 16, "text-anchor": "middle", class: "tick" }, compact(t)));
  }
  svg.append(s("text", { x: m.l + iw / 2, y: height - 6, "text-anchor": "middle", class: "axis-title" }, xLabel));
  svg.append(s("text", { x: 14, y: m.t + ih / 2, "text-anchor": "middle", class: "axis-title",
    transform: `rotate(-90 14 ${m.t + ih / 2})` }, yLabel));
  if (diagonal) svg.append(s("line", { x1: X(x0), y1: Y(y0), x2: X(x1), y2: Y(y1), class: "ref-line" }));
  const g = s("g", { class: "xy-pts" });
  for (const p of points) g.append(s("circle", { cx: X(p.x), cy: Y(p.y), r: 4, class: "xy-pt" }));
  svg.append(g);
  // el rótulo, encima de los puntos (con un borde del color del fondo): en esa esquina suelen amontonarse
  if (diagonal) svg.append(s("text", { x: X(x1) - 6, y: Y(y1) + 16, "text-anchor": "end", class: "ref-label" }, "predicción perfecta"));
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
    if (!best || bd > 20 * 20) { hover.setAttribute("visibility", "hidden"); tip.hide(); return; }
    hover.setAttribute("cx", X(best.x));
    hover.setAttribute("cy", Y(best.y));
    hover.setAttribute("visibility", "visible");
    const k = r.width / width;
    tip.show(X(best.x) * k, Y(best.y) * k, best.title || `${yLabel}: ${fmt(best.y, digits)}`,
      best.tip || `${xLabel}: ${fmt(best.x, digits)}`);
  });
  svg.addEventListener("pointerleave", () => { hover.setAttribute("visibility", "hidden"); tip.hide(); });
  return box;
}

/** Líneas de una a tres series sobre el mismo eje (aciertos en entrenamiento y en el examen…). */
export function multiLine({ series, yMax, yMin = 0, yFormat = (v) => fmt(v), xLabel = "", width = 460, height = 190, label = "" }) {
  const m = { l: 44, r: 14, t: 12, b: 30 };
  const iw = width - m.l - m.r, ih = height - m.t - m.b;
  const all = series.flatMap((sr) => sr.data);
  const xs = all.map((d) => d.x);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const top = yMax ?? Math.max(...all.map((d) => d.y)) * 1.05;
  const ty = ticks(yMin, top, 3).filter((t) => t >= yMin);
  const yTop = ty[ty.length - 1] || 1;
  const X = (v) => m.l + (xMax === xMin ? 0 : ((v - xMin) / (xMax - xMin)) * iw);
  const Y = (v) => m.t + ih - ((v - yMin) / (yTop - yMin || 1)) * ih;
  const svg = s("svg", { viewBox: `0 0 ${width} ${height}`, class: "chart-svg", role: "img", "aria-label": label });
  for (const t of ty) {
    svg.append(s("line", { x1: m.l, x2: m.l + iw, y1: Y(t), y2: Y(t), class: t === yMin ? "axis" : "grid" }));
    svg.append(s("text", { x: m.l - 6, y: Y(t) + 4, "text-anchor": "end", class: "tick" }, yFormat(t)));
  }
  const xt = ticks(xMin, xMax, 5).filter((t) => t >= xMin && t <= xMax && Number.isInteger(t));
  for (const t of xt) svg.append(s("text", { x: X(t), y: height - 10, "text-anchor": "middle", class: "tick" }, t));
  series.forEach((sr, i) => {
    const d = sr.data.map((p, j) => `${j ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
    if (series.length === 1) svg.append(s("path", { d: `${d}L${X(sr.data[sr.data.length - 1].x)},${Y(yMin)}L${X(sr.data[0].x)},${Y(yMin)}Z`, class: "area" }));
    svg.append(s("path", { d, class: "line", style: `stroke:${SERIES[i]}`, pathLength: 1 }));
    const last = sr.data[sr.data.length - 1];
    svg.append(s("circle", { cx: X(last.x), cy: Y(last.y), r: 4, class: "end-dot", style: `fill:${SERIES[i]}` }));
  });
  const cross = s("line", { y1: m.t, y2: m.t + ih, class: "crosshair", visibility: "hidden" });
  svg.append(cross);
  const box = h("div", { class: "chart" }, svg);
  const tip = tooltip(box);
  const overlay = s("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent" });
  svg.append(overlay);
  overlay.addEventListener("pointermove", (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * width;
    let best = series[0].data[0];
    for (const p of series[0].data) if (Math.abs(X(p.x) - px) < Math.abs(X(best.x) - px)) best = p;
    cross.setAttribute("x1", X(best.x));
    cross.setAttribute("x2", X(best.x));
    cross.setAttribute("visibility", "visible");
    const vals = series.map((sr) => {
      const p = sr.data.find((q) => q.x === best.x);
      return p ? `${sr.name}: ${yFormat(p.y)}` : null;
    }).filter(Boolean);
    const k = r.width / width;
    tip.show(X(best.x) * k, m.t * k + 10, `${xLabel} ${best.x}`, vals.join(" · "));
  });
  overlay.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); tip.hide(); });
  if (series.length > 1) {
    box.append(h("div", { class: "legend" }, series.map((sr, i) =>
      h("span", null, h("i", { class: "swatch line-key", style: { background: SERIES[i] } }), sr.name))));
  }
  return box;
}

/**
 * Los grupos de k-medias en un plano (las dos direcciones principales de los datos). Con tres grupos o
 * menos, cada uno con su color; con más, todos en gris y el elegido resaltado (más de tres colores ya no
 * se distinguen bien con daltonismo).
 */
export function groupScatter({ points, centers, k, width = 600, height = 380, onPick }) {
  const pad = 22;
  const xs = points.map((p) => p.x).concat(centers.map((c) => c.x)), ys = points.map((p) => p.y).concat(centers.map((c) => c.y));
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const X = (v) => pad + ((v - x0) / (x1 - x0 || 1)) * (width - 2 * pad);
  const Y = (v) => height - pad - ((v - y0) / (y1 - y0 || 1)) * (height - 2 * pad);
  const colored = k <= 3;
  let active = colored ? null : 1;
  const svg = s("svg", { viewBox: `0 0 ${width} ${height}`, class: "chart-svg scatter groups", role: "img",
    "aria-label": `Las filas en un plano, coloreadas por su grupo (${k} grupos)` });
  svg.append(s("rect", { x: 0.5, y: 0.5, width: width - 1, height: height - 1, rx: 8, class: "plot-frame" }));
  const layer = s("g");
  const centerLayer = s("g");
  svg.append(layer, centerLayer);
  const box = h("div", { class: "chart" }, svg);
  const tip = tooltip(box);
  const legend = h("div", { class: "legend group-legend" });
  function draw() {
    clear(layer);
    clear(centerLayer);
    const order = [...points].sort((p, q) => (p.group === active) - (q.group === active));
    for (const p of order) {
      const on = colored || p.group === active;
      layer.append(s("circle", { cx: X(p.x), cy: Y(p.y), r: on && !colored ? 5 : 4,
        class: "pt" + (colored ? " g" + p.group : on ? " a" : "") }));
    }
    for (const c of centers) {
      const on = colored || c.group === active;
      centerLayer.append(s("circle", { cx: X(c.x), cy: Y(c.y), r: 11, class: "center" + (on ? " on" : "") }),
        s("text", { x: X(c.x), y: Y(c.y) + 4, "text-anchor": "middle", class: "center-label" }, String(c.group)));
    }
    clear(legend);
    const sizes = {};
    points.forEach((p) => { sizes[p.group] = (sizes[p.group] || 0) + 1; });
    for (let g = 1; g <= k; g++) {
      const key = colored ? h("i", { class: "swatch dot", style: { background: SERIES[g - 1] } })
        : h("i", { class: "swatch dot", style: { background: g === active ? "var(--series-1)" : "var(--deemph)" } });
      const label = [key, `Grupo ${g}`, h("span", { class: "faint" }, ` · ${sizes[g] || 0}`)];
      legend.append(colored ? h("span", null, label)
        : h("button", { type: "button", class: "legend-btn" + (g === active ? " on" : ""), "aria-pressed": String(g === active),
          onclick: () => { active = g; draw(); if (onPick) onPick(g); } }, label));
    }
  }
  draw();
  svg.addEventListener("pointermove", (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * width, py = ((ev.clientY - r.top) / r.height) * height;
    let best = null, bd = Infinity;
    for (const p of points) {
      const d = (X(p.x) - px) ** 2 + (Y(p.y) - py) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    if (!best || bd > 18 * 18) { tip.hide(); return; }
    const k2 = r.width / width;
    tip.show(X(best.x) * k2, Y(best.y) * k2, `Grupo ${best.group}`, best.row != null ? `fila ${best.row + 1} de la tabla` : "");
  });
  svg.addEventListener("pointerleave", () => tip.hide());
  box.append(legend);
  box.setActive = (g) => { if (!colored) { active = g; draw(); } };
  return box;
}

// ------------------------------------------------------------------ árboles
function nodeSummary(node, task) {
  if (task === "regression") return { main: fmt(node.mean, 2), share: null };
  const best = Math.max(...node.dist);
  return { main: node.label, share: best };
}

function questionText(q) {
  return q.category != null ? `¿${q.column} = ${q.category}?` : `¿${q.column} ≤ ${fmt(q.threshold, 2)}?`;
}

// rama izquierda y derecha: en una pregunta de número, «sí» a la izquierda; en una de categoría (0/1), «no»
const branchNames = (q) => (q.leftIs === "no" ? ["no", "sí"] : ["sí", "no"]);

/** El árbol dibujado hasta `depth` niveles: cada caja es una pregunta o una respuesta. */
export function treeDiagram({ tree, task, depth = 3, n }) {
  const W = 168, H = 64, GX = 14, GY = 46;
  const nodes = [];
  let leafX = 0;
  function layout(node, d) {
    const item = { node, d, children: [] };
    const kids = node.children && d < depth ? node.children : null;
    if (kids) {
      item.children = kids.map((c) => layout(c, d + 1));
      item.x = (item.children[0].x + item.children[item.children.length - 1].x) / 2;
    } else {
      item.x = leafX++;
    }
    nodes.push(item);
    return item;
  }
  const root = layout(tree, 0);
  const maxD = Math.max(...nodes.map((i) => i.d));
  const width = leafX * (W + GX) + GX, height = (maxD + 1) * (H + GY) + 10;
  const px = (i) => GX + i.x * (W + GX), py = (i) => 8 + i.d * (H + GY);
  const svg = s("svg", { viewBox: `0 0 ${width} ${height}`, width, height, class: "tree-svg", role: "img",
    "aria-label": "El árbol de decisión dibujado" });
  const edges = s("g", { class: "tree-edges" });
  const boxes = s("g");
  svg.append(edges, boxes);
  for (const it of nodes) {
    const x = px(it), y = py(it);
    const nd = it.node;
    it.children.forEach((c, ci) => {
      const cx = px(c) + W / 2, cy = py(c);
      const on = nd.on && c.node.on;
      edges.append(s("path", { d: `M${x + W / 2},${y + H} C${x + W / 2},${y + H + GY / 2} ${cx},${cy - GY / 2} ${cx},${cy}`,
        class: "tree-edge" + (on ? " on" : "") }));
      edges.append(s("text", { x: (x + W / 2 + cx) / 2 + (ci ? 8 : -8), y: y + H + GY / 2 + 4,
        "text-anchor": ci ? "start" : "end", class: "tree-branch" }, branchNames(nd.question)[ci]));
    });
    const sum = nodeSummary(nd, task);
    const leaf = !it.children.length;
    const cut = leaf && (!!nd.children || !!nd.more);  // el árbol sigue, pero no se dibuja tan hondo
    const g = s("g", { class: "tree-node" + (leaf ? " leaf" : "") + (cut ? " cut" : "") + (nd.on ? " on" : "") });
    g.append(s("rect", { x, y, width: W, height: H, rx: 10 }));
    const title = nd.question && !leaf ? questionText(nd.question) : (task === "regression" ? `≈ ${sum.main}` : sum.main);
    g.append(s("title", null, nd.question ? questionText(nd.question) + ` (${nd.n} filas)` : `${title} (${nd.n} filas)`));
    const clip = title.length > 24 ? title.slice(0, 23) + "…" : title;
    g.append(s("text", { x: x + 10, y: y + 22, class: "tree-q" }, clip));
    // en una pregunta con clase, a la derecha va «Adelia 44 %»: sin el % de filas, que no cabría al lado
    const rowsPct = n && (leaf || sum.share == null) ? ` · ${nf(0).format((nd.n / n) * 100)} %` : "";
    const sub = cut ? `${nd.n} filas · sigue…` : `${nd.n} filas` + rowsPct;
    g.append(s("text", { x: x + 10, y: y + 40, class: "tree-n" }, sub));
    if (sum.share != null) {
      g.append(s("rect", { x: x + 10, y: y + 48, width: W - 20, height: 5, rx: 2.5, class: "tree-track" }));
      g.append(s("rect", { x: x + 10, y: y + 48, width: (W - 20) * sum.share, height: 5, rx: 2.5, class: "tree-fill" }));
      if (!leaf) g.append(s("text", { x: x + W - 10, y: y + 40, "text-anchor": "end", class: "tree-n" }, `${sum.main} ${nf(0).format(sum.share * 100)} %`));
      else g.append(s("text", { x: x + W - 10, y: y + 40, "text-anchor": "end", class: "tree-n" }, `${nf(0).format(sum.share * 100)} %`));
    }
    boxes.append(g);
  }
  const box = h("div", { class: "tree-scroll" }, svg);
  // si no cabe, empieza con la raíz en el centro (no pegado a la izquierda, con media rama fuera)
  const ro = new ResizeObserver(() => {
    if (!box.clientWidth) return;
    ro.disconnect();
    if (box.scrollWidth > box.clientWidth) box.scrollLeft = px(root) + W / 2 - box.clientWidth / 2;
  });
  ro.observe(box);
  return box;
}

/** El árbol entero como una lista con sangría: «si aleta ≤ 206,5 → …» (se lee mejor cuando es profundo). */
export function treeOutline({ tree, task }) {
  function item(node) {
    const sum = nodeSummary(node, task);
    if (!node.question || !node.children) {
      const answer = task === "regression" ? `≈ ${sum.main}` : `${sum.main} (${nf(0).format(sum.share * 100)} %)`;
      return h("li", { class: "to-leaf" + (node.on ? " on" : "") }, h("span", { class: "to-arrow" }, "→ "), h("b", null, answer),
        h("span", { class: "faint" }, ` · ${node.n} filas` + (node.more ? " · el árbol sigue preguntando" : "")));
    }
    const [a, b] = branchNames(node.question);
    const q = questionText(node.question);
    return h("li", { class: node.on ? "on" : null },
      h("details", { open: true },
        h("summary", null, h("span", { class: "to-q" }, q), h("span", { class: "faint" }, ` · ${node.n} filas`)),
        h("ul", null,
          h("li", { class: "to-branch" }, h("span", { class: "to-ans" }, a), h("ul", null, item(node.children[0]))),
          h("li", { class: "to-branch" }, h("span", { class: "to-ans" }, b), h("ul", null, item(node.children[1]))))));
  }
  return h("ul", { class: "tree-outline" }, item(tree));
}

/** Una imagen pequeña (data: URL) ampliada sin suavizar, para ver los píxeles. */
export function pixelImage(src, { size = 64, label = "", cls = "" } = {}) {
  return h("img", { src, alt: label, title: label || null, class: "px-img " + cls, width: size, height: size, loading: "lazy" });
}

/** Curva ROC (clasificación de dos clases): aciertos frente a falsas alarmas para cada umbral. */
export function rocChart({ points, auc, positive = "" }) {
  const size = 280, m = { l: 44, r: 12, t: 12, b: 40 };
  const iw = size - m.l - m.r, ih = size - m.t - m.b;
  const X = (v) => m.l + v * iw, Y = (v) => m.t + ih - v * ih;
  const svg = s("svg", { viewBox: `0 0 ${size} ${size}`, class: "chart-svg roc", role: "img",
    "aria-label": `Curva ROC, área bajo la curva ${fmt(auc, 3)}` });
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    svg.append(s("line", { x1: m.l, x2: m.l + iw, y1: Y(t), y2: Y(t), class: t === 0 ? "axis" : "grid" }));
    svg.append(s("text", { x: m.l - 6, y: Y(t) + 4, "text-anchor": "end", class: "tick" }, nf(0).format(t * 100) + " %"));
    svg.append(s("text", { x: X(t), y: m.t + ih + 15, "text-anchor": "middle", class: "tick" }, nf(0).format(t * 100)));
  }
  svg.append(s("text", { x: m.l + iw / 2, y: size - 4, "text-anchor": "middle", class: "axis-title" }, "falsas alarmas (%)"));
  svg.append(s("text", { x: 12, y: m.t + ih / 2, "text-anchor": "middle", class: "axis-title",
    transform: `rotate(-90 12 ${m.t + ih / 2})` }, "aciertos (%)"));
  svg.append(s("line", { x1: X(0), y1: Y(0), x2: X(1), y2: Y(1), class: "ref-line" }));
  svg.append(s("text", { x: X(0.62), y: Y(0.5), class: "ref-label", transform: `rotate(-45 ${X(0.62)} ${Y(0.5)})` }, "al azar"));
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
  svg.append(s("path", { d: `${d}L${X(1)},${Y(0)}L${X(0)},${Y(0)}Z`, class: "roc-area" }));
  svg.append(s("path", { d, class: "roc-line" }));
  if (auc != null) svg.append(s("text", { x: X(0.97), y: Y(0.06), "text-anchor": "end", class: "ref-label" }, `AUC = ${fmt(auc, 3)}`));
  const hover = s("circle", { r: 5, class: "pt-hover", visibility: "hidden" });
  svg.append(hover);
  const box = h("div", { class: "chart", style: { maxWidth: size + 40 + "px" } }, svg);
  const tip = tooltip(box);
  svg.addEventListener("pointermove", (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * size;
    let best = points[0];
    for (const p of points) if (Math.abs(X(p.x) - px) < Math.abs(X(best.x) - px)) best = p;
    hover.setAttribute("cx", X(best.x));
    hover.setAttribute("cy", Y(best.y));
    hover.setAttribute("visibility", "visible");
    const k = r.width / size;
    tip.show(X(best.x) * k, Y(best.y) * k, `${nf(0).format(best.y * 100)} % de aciertos`,
      `${nf(0).format(best.x * 100)} % de falsas alarmas` + (positive ? ` (clase «${positive}»)` : ""));
  });
  svg.addEventListener("pointerleave", () => { hover.setAttribute("visibility", "hidden"); tip.hide(); });
  return box;
}

// color de una variable CSS como [r, g, b] (para pintar en un <canvas>)
function cssColor(name) {
  const probe = h("span", { style: { color: `var(${name})`, display: "none" } });
  document.body.append(probe);
  const rgb = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g) || [235, 104, 52];
  probe.remove();
  return rgb.slice(0, 3).map(Number);
}

const loadImage = (src) => new Promise((resolve, reject) => {
  const im = new Image();
  im.onload = () => resolve(im);
  im.onerror = reject;
  im.src = src;
});

/**
 * La imagen con el mapa de saliencia encima: los píxeles que más han pesado en la decisión, en naranja
 * (una sola tinta que va de transparente a intensa: es una magnitud).
 */
export function saliencyOverlay(imageSrc, salSrc, { size = 128, label = "Dónde ha mirado" } = {}) {
  const canvas = h("canvas", { width: size, height: size, role: "img", "aria-label": label });
  (async () => {
    const [img, sal] = await Promise.all([loadImage(imageSrc), loadImage(salSrc)]);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, size, size);
    const base = ctx.getImageData(0, 0, size, size);
    const tmp = h("canvas", { width: size, height: size });
    const tctx = tmp.getContext("2d", { willReadFrequently: true });
    tctx.imageSmoothingEnabled = true;
    tctx.drawImage(sal, 0, 0, size, size);
    const heat = tctx.getImageData(0, 0, size, size).data;
    const [r, g, b] = cssColor("--series-2");
    const px = base.data;
    for (let i = 0; i < px.length; i += 4) {
      const a = Math.pow(heat[i] / 255, 1.3) * 0.88;
      // la foto un poco apagada debajo, para que se vea dónde está el naranja
      px[i] = px[i] * 0.55 * (1 - a) + r * a;
      px[i + 1] = px[i + 1] * 0.55 * (1 - a) + g * a;
      px[i + 2] = px[i + 2] * 0.55 * (1 - a) + b * a;
    }
    ctx.putImageData(base, 0, 0);
  })().catch(() => {});
  return canvas;
}
