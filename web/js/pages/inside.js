// «Por dentro»: cómo funciona el motor de lenguaje, paso a paso y con sus fórmulas. Cada sección
// cuenta qué hace, la fórmula (MathML, ver math.js), qué significa cada símbolo, lo que le pasa a
// una frase de ejemplo del agente con sus números reales y dónde está en el código.
import { api } from "../api.js";
import { h, icon, clear, errorToast, pageHead, busy } from "../ui.js";
import { barList, format } from "../charts.js";
import { tex } from "../math.js";
import { state } from "../app.js";

const SVGNS = "http://www.w3.org/2000/svg";
function sv(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const k of kids.flat()) if (k != null) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

const num = (v, d = 2) => format.nf(d).format(v);
const pct = (v) => format.nf(0).format(v * 100) + "\u00a0%";
const two = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (v) => (Math.abs(v) < 0.005 ? "0,00" : (v > 0 ? "+" : "−") + two.format(Math.abs(v)));
const clean = (s) => String(s).replace(/[{}\\&]/g, "");  // texto del agente dentro de una fórmula
const KIND = { w: "palabra", b: "pareja", e: "entidad", c: "letras", p: "signo" };
const simFactor = (s) => Math.min(1, s / 0.65) ** 2;
const conf = (p, s) => Math.sqrt(p) * simFactor(s);

// ------------------------------------------------------------- piezas comunes
// una fórmula, o varias que se colocan una al lado de otra (y una debajo de otra si no caben)
const formula = (src) => h("div", { class: "formula" }, [src].flat().map((s) => tex(s, { display: true })));
const legend = (rows) => h("dl", { class: "sym-legend" },
  rows.map(([sym, text]) => [h("dt", null, tex(sym)), h("dd", null, text)]));
const codeRef = (...paths) => h("div", { class: "code-ref" }, icon("code"), "En el código: ",
  paths.map((p, i) => [i ? ", " : "", h("code", null, p)]));
const note = (...kids) => h("div", { class: "notice info in-note" }, icon("info"), h("div", null, ...kids));

function liveBox(title = "Con tu frase") {
  const body = h("div", { class: "live-body" });
  return [h("div", { class: "live" }, h("div", { class: "live-title" }, icon("sparkle"), title), body), body];
}

// ---------------------------------------------------------- distancia de edición
function osa(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  // camino de vuelta: qué operaciones dan esa distancia
  const path = new Set();
  const ops = [];
  let i = a.length, j = b.length;
  path.add(`${i},${j}`);
  while (i > 0 || j > 0) {
    if (i && j && a[i - 1] === b[j - 1] && d[i][j] === d[i - 1][j - 1]) { ops.push(["=", a[i - 1]]); i--; j--; }
    else if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] && d[i][j] === d[i - 2][j - 2] + 1) {
      ops.push(["⇄", a[i - 2] + a[i - 1], b[j - 2] + b[j - 1]]); i -= 2; j -= 2;
    } else if (i && j && d[i][j] === d[i - 1][j - 1] + 1) { ops.push(["≠", a[i - 1], b[j - 1]]); i--; j--; }
    else if (i && d[i][j] === d[i - 1][j] + 1) { ops.push(["−", a[i - 1]]); i--; }
    else { ops.push(["+", b[j - 1]]); j--; }
    path.add(`${i},${j}`);
  }
  return { d, path, ops: ops.reverse(), dist: d[a.length][b.length] };
}

const normWord = (s) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");

function editView(typed, known) {
  const a = normWord(typed), b = normWord(known);
  if (!a || !b) return h("div", { class: "muted small" }, "Escribe dos palabras.");
  const { d, path, ops, dist } = osa(a, b);
  const table = h("table", { class: "dp-table" },
    h("thead", null, h("tr", null, h("th"), h("th", { class: "faint" }, "∅"), [...b].map((ch) => h("th", null, ch)))),
    h("tbody", null, d.map((row, i) => h("tr", null, h("th", { class: i ? null : "faint" }, i ? a[i - 1] : "∅"),
      row.map((v, j) => h("td", { class: (path.has(`${i},${j}`) ? "on" : "") + (i === a.length && j === b.length ? " final" : "") }, String(v)))))));
  const OPS = { "=": "igual", "≠": "cambiar", "+": "insertar", "−": "borrar", "⇄": "intercambiar" };
  return h("div", { class: "edit-view" },
    h("div", { class: "table-scroll" }, table),
    h("div", { class: "ops" }, ops.map(([op, x, y]) => h("span", { class: "op " + (op === "=" ? "same" : "chg"), title: OPS[op] },
      op === "=" ? x : op === "≠" ? `${x}→${y}` : op === "⇄" ? `${x}⇄${y}` : `${op}${x}`))),
    h("div", { class: "small" }, "Distancia ", h("b", null, String(dist)), dist <= (a.length >= 9 ? 2 : 1)
      ? " → se puede corregir" : ` → demasiado lejos (máximo ${a.length >= 9 ? 2 : 1})`));
}

const deletes = (w) => [...new Set([...w].map((_, i) => w.slice(0, i) + w.slice(i + 1)))];

function deletesView(typed, known) {
  const a = normWord(typed), b = normWord(known);
  const fromKnown = [b, ...deletes(b)], fromTyped = [a, ...deletes(a)];
  const chips = (list, other) => h("div", { class: "in-chips" }, list.map((x) => h("span", { class: "in-chip" + (other.includes(x) ? " hit" : "") }, x)));
  const hit = fromTyped.some((x) => fromKnown.includes(x));
  return h("div", { class: "col", style: { gap: "8px" } },
    h("div", { class: "small muted" }, "Índice (al entrenar): «", b, "» y sus versiones con una letra menos"), chips(fromKnown, fromTyped),
    h("div", { class: "small muted" }, "Al corregir: «", a, "» y sus versiones con una letra menos"), chips(fromTyped, fromKnown),
    h("div", { class: "small" }, hit ? ["Coinciden en lo resaltado: «", b, "» es candidata y se calcula su distancia."]
      : ["No coinciden: «", b, "» ni siquiera se compara (por eso es rápido)."]));
}

// ------------------------------------------------------------- zonas del stemmer
function regions(w) {
  const V = new Set("aeiou");
  const n = w.length;
  const after = (start) => { for (let i = start + 1; i < n; i++) if (!V.has(w[i]) && V.has(w[i - 1])) return i + 1; return n; };
  const r1 = after(0), r2 = r1 < n ? after(r1) : n;
  let rv = n;
  if (n >= 2) {
    if (!V.has(w[1])) { for (let i = 2; i < n; i++) if (V.has(w[i])) { rv = i + 1; break; } }
    else if (V.has(w[0])) { for (let i = 2; i < n; i++) if (!V.has(w[i])) { rv = i + 1; break; } }
    else rv = n >= 3 ? 3 : n;
  }
  return { r1, r2, rv };
}

function stemView(word, stem) {
  const { r1, r2, rv } = regions(word);
  const keep = word.startsWith(stem) ? stem.length : -1;
  const n = word.length;
  const bar = (from, cls, label) => (from < n
    ? h("div", { class: "rg " + cls, style: { gridColumn: `${from + 1} / ${n + 1}` }, title: label }, label)
    : h("div", { class: "rg none", style: { gridColumn: `1 / ${n + 1}`, gridRow: { r1: 2, r2: 3, rv: 4 }[cls] } }, `${label} vacía`));
  return h("div", { class: "stem-word" },
    h("div", { class: "letters", style: { gridTemplateColumns: `repeat(${n}, 1.25em) auto` } },
      [...word].map((ch, i) => h("span", { class: "lt" + (keep >= 0 && i >= keep ? " cut" : "") }, ch)),
      h("span", { class: "arrow" }, "→ ", h("b", null, stem)),
      bar(r1, "r1", "R1"), bar(r2, "r2", "R2"), bar(rv, "rv", "RV")));
}

// ------------------------------------------------------- entidades sobre los tokens
const SOURCES = { dict: "forma exacta", regex: "expresión regular", sys: "del sistema", stem: "por la raíz", fuzzy: "forma corregida" };
const valueText = (v) => (v && typeof v === "object" ? JSON.stringify(v) : String(v));

// La frase con cada entidad elegida en su caja (tipo y valor debajo); las descartadas, en una lista.
function spansView(an) {
  if (!an.entities.length && !(an.candidates || []).length) return h("div", { class: "muted small" }, "En esta frase no hay entidades.");
  const toks = an.tokens;
  const idx = (e) => {
    const cov = toks.map((t, i) => (t.start >= e.start && t.end <= e.end ? i : -1)).filter((i) => i >= 0);
    return cov.length ? [cov[0], cov[cov.length - 1] + 1] : null;
  };
  const chosen = an.entities.map((e) => ({ e, span: idx(e) })).filter((r) => r.span).sort((a, b) => a.span[0] - b.span[0]);
  const line = h("div", { class: "ner" });
  let i = 0;
  for (const { e, span } of chosen) {
    while (i < span[0]) line.append(h("span", { class: "ner-tok" }, toks[i++].text));
    line.append(h("span", { class: "ner-ent", title: `${e.entity} = ${valueText(e.value)} (${SOURCES[e.source] || e.source}, confianza ${num(e.score)})` },
      h("span", { class: "ner-text" }, toks.slice(span[0], span[1]).map((t) => t.text).join(" ")),
      h("span", { class: "ner-tag" }, h("b", null, e.entity), " = ", valueText(e.value))));
    i = span[1];
  }
  while (i < toks.length) line.append(h("span", { class: "ner-tok" }, toks[i++].text));
  const out = [line];
  if (chosen.length) {
    out.push(h("div", { class: "small muted" }, "Cómo se encontró cada una: ",
      chosen.map(({ e }, k) => [k ? "; " : "", h("code", null, e.entity), ` ${SOURCES[e.source] || e.source} (${num(e.score)})`]), "."));
  }
  const dropped = (an.candidates || []).filter((e) => idx(e));
  if (dropped.length) {
    out.push(h("div", { class: "small muted" }, "Descartadas por pisarse con otra que va antes: ",
      dropped.map((e, k) => [k ? ", " : "", "«", e.text, "» como ", h("code", null, e.entity)]), "."));
  }
  return out;
}

// ------------------------------------------------------------------ gráficos
// La curva del IDF con las palabras y entidades de la frase: un punto numerado por cada df distinto
// (las que comparten df caen en el mismo sitio) y, al lado, la tabla con sus números.
function idfFigure(K, feats) {
  const idf = (df) => Math.log((1 + K) / (1 + df)) + 1;
  const byDf = new Map();
  for (const f of feats) {
    if (f.kind !== "w" && f.kind !== "e") continue;
    const df = Math.max(1, Math.min(K, Math.round((1 + K) / Math.exp(f.idf - 1) - 1)));  // despejado del idf
    if (!byDf.has(df)) byDf.set(df, []);
    byDf.get(df).push(f.label);
  }
  const groups = [...byDf].sort((a, b) => a[0] - b[0]).slice(0, 8).map(([df, labels], i) => ({ n: i + 1, df, labels }));

  const W = 360, H = 230, m = { l: 34, r: 14, t: 16, b: 36 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const yTop = Math.ceil(idf(1) * 2) / 2;
  const X = (df) => m.l + ((df - 1) / Math.max(1, K - 1)) * iw, Y = (v) => m.t + ih - (v / yTop) * ih;
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart-svg in-chart idf-chart", role: "img",
    "aria-label": "IDF según en cuántas intenciones aparece un rasgo, con los de tu frase" });
  for (let v = 0; v <= yTop + 1e-9; v += yTop > 3 ? 1 : 0.5) {
    svg.append(sv("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: "grid" }),
      sv("text", { x: m.l - 6, y: Y(v) + 4, class: "tick", "text-anchor": "end" }, num(v, 1)));
  }
  const curve = Array.from({ length: 121 }, (_, k) => { const df = 1 + (k / 120) * (K - 1); return `${X(df).toFixed(1)},${Y(idf(df)).toFixed(1)}`; });
  svg.append(sv("polyline", { points: curve.join(" "), class: "line" }));
  for (const df of [1, Math.round((K + 1) / 2), K]) svg.append(sv("text", { x: X(df), y: H - m.b + 16, class: "tick", "text-anchor": "middle" }, String(df)));
  svg.append(sv("text", { x: m.l + iw / 2, y: H - 4, class: "axis-label", "text-anchor": "middle" }, "df: intenciones que usan el rasgo"));
  // los números van en fila sobre una curva paralela, por fuera (a la derecha donde es empinada,
  // encima donde es plana): cada uno lo más cerca de su punto sin pisar al anterior
  const OFF = 17, GAP = 19, S = 400;
  const rail = [];
  for (let k = 0; k <= S; k++) {
    const df = 1 + (k / S) * (K - 1), a = Math.max(1, df - 0.25), b = Math.min(K, df + 0.25);
    const slope = (Y(idf(b)) - Y(idf(a))) / (X(b) - X(a) || 1), len = Math.hypot(slope, 1);
    const p = { x: X(df) + (slope / len) * OFF, y: Y(idf(df)) - OFF / len, s: 0 };
    if (k) p.s = rail[k - 1].s + Math.hypot(p.x - rail[k - 1].x, p.y - rail[k - 1].y);
    rail.push(p);
  }
  const sOf = (df) => rail[Math.round(((df - 1) / Math.max(1, K - 1)) * S)].s;
  const at = (s) => {
    let k = rail.findIndex((p) => p.s >= s);
    if (k <= 0) return rail[k < 0 ? S : 0];
    const p = rail[k - 1], q = rail[k], f = (s - p.s) / (q.s - p.s || 1);
    return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f };
  };
  const ss = groups.map((g) => sOf(g.df));
  for (let i = 1; i < ss.length; i++) ss[i] = Math.max(ss[i], ss[i - 1] + GAP);
  const last = rail[S].s - 10;
  for (let i = ss.length - 1; i >= 0; i--) ss[i] = Math.min(ss[i], i === ss.length - 1 ? last : ss[i + 1] - GAP);
  groups.forEach((g, i) => {
    const x = X(g.df), y = Y(idf(g.df)), b = at(ss[i]);
    const bx = Math.min(W - 10, b.x), by = Math.max(10, b.y);
    svg.append(sv("line", { x1: x, y1: y, x2: bx, y2: by, class: "leader" }),
      sv("circle", { cx: x, cy: y, r: 4, class: "pt-live" }),
      sv("circle", { cx: bx, cy: by, r: 8.5, class: "badge" }),
      sv("text", { x: bx, y: by + 3.6, class: "badge-num", "text-anchor": "middle" }, String(g.n)));
  });
  const table = h("table", { class: "mini-table" },
    h("thead", null, h("tr", null, h("th", { "aria-label": "Número" }), h("th", null, "Rasgo"), h("th", { class: "num" }, "df"), h("th", { class: "num" }, "idf"))),
    h("tbody", null, groups.map((g) => h("tr", null, h("td", null, h("span", { class: "badge-dot" }, String(g.n))),
      h("td", null, g.labels.join(", ")), h("td", { class: "num" }, String(g.df)), h("td", { class: "num" }, two.format(idf(g.df)))))));
  return h("div", { class: "row wrap in-pair idf-pair" }, svg, h("div", { class: "table-scroll" }, table));
}

// Cascada: cada rasgo suma (o resta) su parte a la puntuación, empezando por el sesgo. En HTML, para
// que el texto se lea igual de bien en un móvil.
function waterfall(c) {
  const steps = [{ label: "sesgo (punto de partida)", v: c.bias }];
  for (const f of [...c.positive, ...c.negative]) {
    if (Math.abs(f.contribution) >= 0.005) steps.push({ label: f.label, sub: KIND[f.kind], v: f.contribution });
  }
  const rest = c.score - steps.reduce((s, x) => s + x.v, 0);
  if (Math.abs(rest) > 0.005) steps.push({ label: "el resto de rasgos", v: rest });
  let cum = 0;
  const rows = steps.map((st) => { const from = cum; cum += st.v; return { ...st, from, to: cum }; });
  rows.push({ label: "puntuación z", total: true, from: 0, to: c.score });
  const lo = Math.min(0, ...rows.map((r) => Math.min(r.from, r.to))), hi = Math.max(0, ...rows.map((r) => Math.max(r.from, r.to)));
  const P = (v) => (((v - lo) / (hi - lo || 1)) * 100).toFixed(2) + "%";
  return h("div", { class: "wf", role: "img", "aria-label": `Cómo se suma la puntuación de ${c.name}: ${two.format(c.score)}` },
    rows.map((r, i) => {
      const a = Math.min(r.from, r.to), b = Math.max(r.from, r.to);
      const cls = r.total ? "total" : r.to >= r.from ? "pos" : "neg";
      return h("div", { class: "wf-row" + (r.total ? " total" : ""), style: { "--i": i } },
        h("div", { class: "wf-label", title: r.label }, r.label, r.sub ? h("span", { class: "faint" }, " " + r.sub) : null),
        h("div", { class: "wf-track" },
          h("span", { class: "wf-zero", style: { left: P(0) } }),
          h("span", { class: "wf-bar " + cls, style: { left: P(a), width: `calc(${P(b)} - ${P(a)})` } }),
          i < rows.length - 1 && !rows[i + 1].total ? h("span", { class: "wf-link", style: { left: P(r.to) } }) : null),
        h("div", { class: "wf-val" }, r.total ? two.format(r.to).replace("-", "−") : signed(r.to - r.from)));
    }));
}

function cosineView(sim) {
  const s = Math.max(-1, Math.min(1, sim));
  const th = Math.acos(s);
  const W = 250, H = 190, ox = 34, oy = 174, L = 150, a0 = 0.12;  // cabe hasta 90° (los rasgos no son negativos)
  const pt = (a, r = L) => [ox + r * Math.cos(a), oy - r * Math.sin(a)];
  const [ax, ay] = pt(a0), [bx, by] = pt(a0 + th);
  const [r1x, r1y] = pt(a0, 54), [r2x, r2y] = pt(a0 + th, 54);
  const [lx, ly] = pt(a0 + th / 2, 70);
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart-svg in-chart cosine", role: "img", "aria-label": "Ángulo entre dos frases" });
  svg.append(sv("defs", {}, sv("marker", { id: "in-arrow", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" },
    sv("path", { d: "M0,0 L10,5 L0,10 z", class: "arrow-head" }))),
  sv("path", { d: `M${r1x},${r1y} A54,54 0 0 0 ${r2x},${r2y}`, class: "arc" }),
  sv("line", { x1: ox, y1: oy, x2: ax, y2: ay, class: "vec a", "marker-end": "url(#in-arrow)" }),
  sv("line", { x1: ox, y1: oy, x2: bx, y2: by, class: "vec b", "marker-end": "url(#in-arrow)" }),
  sv("text", { x: ax - 12, y: ay + 20, class: "pt-label", "text-anchor": "end" }, "tu frase"),
  sv("text", { x: bx + 6, y: by + 4, class: "pt-label" }, "la más parecida"),
  sv("text", { x: lx + 4, y: ly + 4, class: "pt-label strong" }, `θ = ${num((th * 180) / Math.PI, 0)}°`));
  return svg;
}

function confidenceMap(threshold, points, you) {
  const W = 360, H = 330, m = { l: 46, r: 16, t: 12, b: 42 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const X = (s) => m.l + s * iw, Y = (p) => m.t + (1 - p) * ih;
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart-svg in-chart conf-map", role: "img",
    "aria-label": "Confianza según la probabilidad y el parecido, con la línea del umbral" });
  const N = 36;
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      const c = conf((b + 0.5) / N, (a + 0.5) / N);
      svg.append(sv("rect", { x: X(a / N), y: Y((b + 1) / N), width: iw / N + 0.5, height: ih / N + 0.5, class: "cm-cell",
        "fill-opacity": (0.04 + 0.86 * c).toFixed(3) }));
    }
  }
  // umbral: √p·min(1, s/0,65)² = umbral  →  p = umbral² / min(1, s/0,65)⁴
  const line = [];
  for (let k = 1; k <= 240; k++) {
    const s = k / 240, f = Math.min(1, s / 0.65), p = threshold ** 2 / f ** 4;
    if (p <= 1) line.push(`${X(s)},${Y(p)}`);
  }
  svg.append(sv("polyline", { points: line.join(" "), class: "cm-thr" }));
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    svg.append(sv("text", { x: X(v), y: H - m.b + 16, class: "tick", "text-anchor": "middle" }, num(v, 2)),
      sv("text", { x: m.l - 6, y: Y(v) + 4, class: "tick", "text-anchor": "end" }, num(v, 2)));
  }
  svg.append(sv("line", { x1: X(0.65), x2: X(0.65), y1: m.t, y2: m.t + ih, class: "cm-guide" }),
    sv("text", { x: X(0.65), y: m.t - 3, class: "tick", "text-anchor": "middle" }, "0,65"),
    sv("text", { x: m.l + iw / 2, y: H - 6, class: "axis-label", "text-anchor": "middle" }, "parecido (sim)"),
    sv("text", { x: 12, y: m.t + ih / 2, class: "axis-label", "text-anchor": "middle", transform: `rotate(-90 12 ${m.t + ih / 2})` }, "probabilidad (p)"),
    sv("text", { x: X(0.97), y: Y(0.5), class: "cm-zone", "text-anchor": "end" }, "acepta"),
    sv("text", { x: X(0.03), y: Y(0.04), class: "cm-zone" }, "fallback"));
  points.forEach((pnt, i) => {
    const cx = X(Math.max(0, Math.min(1, pnt.sim))), cy = Y(Math.max(0, Math.min(1, pnt.prob)));
    svg.append(sv("circle", { cx, cy, r: i ? 4 : 6.5, class: "pt-live" + (i ? " minor" : "") }));
    // el nombre de la primera, y el de la segunda si no está pegada al suelo (taparía la línea del umbral)
    if (i === 0 || (i === 1 && pnt.prob >= 0.12)) {
      svg.append(sv("text", { x: cx + (cx > W - 120 ? -9 : 9), y: cy - 8, class: "pt-label", "text-anchor": cx > W - 120 ? "end" : "start" }, pnt.name));
    }
  });
  if (you) {  // «tú» a la izquierda del círculo (el nombre de la intención va arriba a la derecha)
    const cx = X(you.sim), left = cx > m.l + 34;
    svg.append(sv("circle", { cx, cy: Y(you.prob), r: 8, class: "pt-you" }),
      sv("text", { x: cx + (left ? -12 : 12), y: Y(you.prob) + 4, class: "pt-label strong", "text-anchor": left ? "end" : "start" }, "tú"));
  }
  return svg;
}

function kernelsFigure() {
  const W = 420, H = 190, m = { l: 34, r: 14, t: 12, b: 34 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const X = (d) => m.l + (d / 4) * iw, Y = (v) => m.t + ih - v * ih;
  const curve = (f) => Array.from({ length: 81 }, (_, k) => `${X(k / 20)},${Y(f(k / 20))}`).join(" ");
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart-svg in-chart", role: "img", "aria-label": "Campana de Gauss frente a la t de Student" });
  for (const v of [0, 0.5, 1]) svg.append(sv("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: "grid" }),
    sv("text", { x: m.l - 6, y: Y(v) + 4, class: "tick", "text-anchor": "end" }, num(v, 1)));
  for (const d of [0, 1, 2, 3, 4]) svg.append(sv("text", { x: X(d), y: H - m.b + 16, class: "tick", "text-anchor": "middle" }, String(d)));
  svg.append(sv("polyline", { points: curve((d) => Math.exp(-d * d)), class: "line" }),
    sv("polyline", { points: curve((d) => 1 / (1 + d * d)), class: "line b" }),
    sv("text", { x: m.l + iw / 2, y: H - 4, class: "axis-label", "text-anchor": "middle" }, "distancia"));
  return h("div", { class: "in-figure" }, svg, h("div", { class: "chart-legend small muted" },
    h("span", null, h("span", { class: "legend-key a" }), tex("e^{-d^2}"), "Gauss (espacio original)"),
    h("span", null, h("span", { class: "legend-key b" }), tex("(1 + d^2)^{-1}"), "t de Student (mapa)")));
}

const kfold = () => h("div", { class: "kfold" }, [0, 1, 2, 3, 4].map((r) => h("div", { class: "kf-row" },
  h("span", { class: "kf-label" }, `Ronda ${r + 1}`),
  [0, 1, 2, 3, 4].map((c) => h("span", { class: "kf-cell" + (c === r ? " test" : "") }, c === r ? "examen" : "entrena")))));

function contextsTimeline() {
  const turns = [
    ["«una pizza barbacoa grande»", { pedido: 5, "pedido-entrega": 2 }],
    ["«a domicilio»", { pedido: 4, "pedido-entrega": 1, "pedido-bebida": 2 }],
    ["«sí»", { pedido: 3, "pedido-bebida": 1 }],
    ["«gracias»", { pedido: 2 }],
  ];
  const names = ["pedido", "pedido-entrega", "pedido-bebida"];
  return h("div", { class: "table-scroll" }, h("table", { class: "mini-table ctx-table" },
    h("thead", null, h("tr", null, h("th", null, "Turno"), names.map((n) => h("th", null, n)))),
    h("tbody", null, turns.map(([text, ctx], i) => h("tr", null, h("td", null, h("span", { class: "faint" }, `${i + 1} · `), text),
      names.map((n) => h("td", null, ctx[n] ? h("span", { class: "life" }, h("span", { class: "life-bar", style: { width: ctx[n] * 18 + "px" } }), String(ctx[n]))
        : h("span", { class: "faint" }, "—"))))))));
}

function dialogFlow() {
  const box = (t, cls = "") => h("div", { class: "fl-box " + cls }, t);
  const down = () => h("div", { class: "fl-down" }, "↓");
  return h("div", { class: "dlg-flow" },
    box("Llega un mensaje (o un evento como WELCOME)", "start"), down(),
    h("div", { class: "fl-split" }, box("¿Había una pregunta pendiente?"),
      h("div", { class: "fl-branch" }, h("span", { class: "fl-tag" }, "sí"),
        box(["«cancelar» → la abandona", h("br"), "trae el dato → lo rellena", h("br"), "otra intención > 0,8 → cambia de tema", h("br"), "si no → vuelve a preguntar"], "side"))),
    down(), box("Analiza la frase: contextos activos → modelo → umbral → intención o fallback"), down(),
    h("div", { class: "fl-split" }, box("¿Falta algún parámetro obligatorio?"),
      h("div", { class: "fl-branch" }, h("span", { class: "fl-tag" }, "sí"), box("Pregunta uno de sus prompts y se queda esperando", "side"))),
    down(), box("Contextos de salida, respuesta (sin repetir la última variante), webhook si está activo", "end"));
}

// ===================================================================== página
const SECTIONS = [
  ["recorrido", "El recorrido de una frase"], ["tokens", "Tokenizar y normalizar"], ["faltas", "Corregir las faltas"],
  ["raices", "Quedarse con la raíz"], ["entidades", "Encontrar las entidades"], ["rasgos", "La frase como rasgos"],
  ["tfidf", "Pesar los rasgos: TF-IDF"], ["regresion", "La regresión logística"], ["parecido", "El parecido"],
  ["confianza", "Confianza y umbral"], ["decision", "La decisión"], ["parametros", "Los parámetros"],
  ["dialogo", "La conversación"], ["mapa", "El mapa de frases (t-SNE)"], ["examen", "El examen"],
];
const PIPELINE = [
  ["tokens", "text", "Tokens"], ["faltas", "edit", "Faltas"], ["raices", "hash", "Raíces"], ["entidades", "tag", "Entidades"],
  ["rasgos", "list", "Rasgos"], ["tfidf", "gauge", "TF-IDF"], ["regresion", "cpu", "Regresión"], ["parecido", "target", "Parecido"],
  ["confianza", "check", "Confianza"], ["decision", "zap", "Decisión"], ["parametros", "braces", "Parámetros"],
];

// frases de ejemplo que pasan por todos los pasos: una falta, raíces, varias entidades y una decisión
// del modelo (no una coincidencia exacta) en la que cuentan la probabilidad y el parecido
function defaultPhrase(agent) {
  if (agent.id === "pizzeria") return "me pones dos pizas barbacoa familiares pa mañana";
  if (agent.id === "hotel") return "busco una dobel para dos noches desde el viernes";
  for (const it of agent.intents || []) {
    if (it.isFallback) continue;
    const p = (it.trainingPhrases || []).find((x) => (x.annotations || []).length && x.text.split(/\s+/).length >= 3);
    if (p) return p.text;
  }
  const any = (agent.intents || []).flatMap((i) => i.trainingPhrases || [])[0];
  return any ? any.text : "hola";
}

export async function render(el) {
  const page = h("div", { class: "page inside cq" });
  el.append(page);
  let agent = state.agent;
  if (!agent) {
    const list = state.agents.length ? state.agents : await api.agents().catch(() => []);
    const pick = list.find((a) => a.id === "pizzeria") || list[0];
    agent = pick ? await api.agent(pick.id).catch(() => null) : null;
  }
  const classes = agent ? agent.intents.filter((i) => (i.trainingPhrases || []).length).length : 0;
  const eligible = agent ? agent.intents.filter((i) => (i.trainingPhrases || []).length && !(i.inputContexts || []).length).length : 0;
  let ex = null, an = null;
  const drawers = [];
  const live = (fn, title) => {
    const [box, body] = liveBox(title);
    drawers.push(() => { clear(body); if (ex && an) body.append(...[fn()].flat().filter(Boolean)); });
    return box;
  };

  page.append(pageHead({ icon: "cpu", title: "Por dentro",
    sub: "Cómo funciona el motor de lenguaje de Lince, paso a paso: qué hace, con qué fórmulas y con los números de verdad de una frase de tu agente." }));

  // ---------------------------------------------------------------- índice
  const links = new Map();
  const toc = h("nav", { class: "toc", "aria-label": "Índice" }, h("div", { class: "toc-title" }, "Contenido"),
    SECTIONS.map(([id, title], i) => {
      const a = h("a", { href: "#", onclick: (e) => { e.preventDefault(); go(id); } }, i ? `${i}. ${title}` : title);
      links.set(id, a);
      return a;
    }));
  const go = (id) => document.getElementById("in-" + id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const content = h("div", { class: "in-content" });
  page.append(h("div", { class: "guide-layout" }, toc, content));

  const section = (id, n, lead, ...body) => h("section", { class: "card in-sec", id: "in-" + id },
    h("div", { class: "card-head" }, h("span", { class: "sec-num" }, String(n)), h("h2", null, SECTIONS[n][1])),
    h("div", { class: "card-body col in-body" }, h("p", { class: "lead" }, lead), ...body));

  // ---------------------------------------------------- 0. la frase y el recorrido
  const input = h("input", { type: "text", "aria-label": "Frase de ejemplo", value: agent ? defaultPhrase(agent) : "",
    onkeydown: (e) => { if (e.key === "Enter") run(); } });
  const runBtn = h("button", { class: "btn primary", type: "button", onclick: () => run() }, icon("play"), "Analizar");
  const pills = new Map();
  const pipeline = h("div", { class: "pipeline" }, PIPELINE.map(([id, ic, label], i) => {
    const val = h("span", { class: "pl-val" }, "…");
    pills.set(id, val);
    return [i ? h("span", { class: "pl-arrow", "aria-hidden": "true" }, icon("arrowRight")) : null,
      h("button", { class: "pl-step", type: "button", onclick: () => go(id) },
        h("span", { class: "pl-head" }, icon(ic), h("span", null, `${i + 1}. ${label}`)), val)];
  }));
  content.append(h("section", { class: "card in-sec hero", id: "in-recorrido" },
    h("div", { class: "card-head" }, icon("sparkle"), h("h2", null, "El recorrido de una frase")),
    h("div", { class: "card-body col in-body" },
      h("p", { class: "lead" }, "Cuando le escribes al bot, la frase pasa por once pasos hasta que el agente decide qué has querido decir y con qué datos. Esta página explica cada uno con su fórmula. Todo lo que ves con ", icon("sparkle"), " se calcula con la frase de abajo y el agente ", h("b", null, agent ? agent.name : "(ninguno)"), ": cámbiala y mira cómo cambian los números."),
      agent ? h("div", { class: "in-input" }, input, runBtn)
        : h("div", { class: "notice" }, icon("info"), "Crea un agente para ver los ejemplos con números reales."),
      pipeline,
      h("p", { class: "small muted" }, "Pulsa un paso para ir a su explicación. Los pasos 12 a 14 (la conversación, el mapa y el examen) no son de una frase sino del agente entero."))));

  // ----------------------------------------------------------- 1. tokens
  content.append(section("tokens", 1,
    "Lo primero es partir el texto en piezas (tokens) y dejar cada una en una forma estándar, para que «Pízzas», «pizzas» y «PIZZAS» sean la misma palabra.",
    h("p", null, "Una expresión regular reconoce, por este orden, ", h("b", null, "direcciones web, correos, horas (17:30), fechas (15/03/2026), números (1.000,5), palabras y signos"), ". Cada token guarda dónde estaba en el texto original, para poder resaltarlo después. Luego cada palabra se normaliza:"),
    formula("\\hat{w} = \\op{repeticiones}\\left(\\op{tildes}\\left(\\op{minúsculas}(w)\\right)\\right)"),
    h("ul", { class: "in-list" },
      h("li", null, h("b", null, "minúsculas"), " con ", h("code", null, "casefold"), " (también para letras como la ß)."),
      h("li", null, h("b", null, "tildes"), ": se descompone cada letra (NFD) y se quitan los acentos; la ñ queda como n."),
      h("li", null, h("b", null, "repeticiones"), ": tres letras iguales o más se quedan en una («holaaaa» → «hola») y las risas, en «jaja»."),
      h("li", null, "Las ", h("b", null, "abreviaturas de chat"), " se expanden («xfa» → «por favor», «q» → «que», «finde») y también las reglas de normalización del agente (", h("i", null, "Ajustes"), ").")),
    live(() => {
      const KINDS = { word: "palabra", number: "número", time: "hora", date: "fecha", url: "web", email: "correo", symbol: "signo" };
      return h("div", { class: "table-scroll" }, h("table", { class: "mini-table tok-table" },
        h("thead", null, h("tr", null, ["Original", "Tipo", "Normalizado", "Corregido", "Raíz"].map((t, i) => h("th", { class: [null, "c-kind", "c-norm"][i] }, t)))),
        h("tbody", null, an.tokens.map((t) => h("tr", null,
          h("td", null, h("b", null, t.text)), h("td", { class: "muted c-kind" }, KINDS[t.kind] || t.kind),
          h("td", { class: "c-norm" }, h("code", { class: t.norm !== t.text ? "chg" : null }, t.norm), t.expanded ? h("span", { class: "faint small" }, " (expandida)") : null),
          h("td", null, t.corrected ? h("code", { class: "chg" }, t.corrected) : h("span", { class: "faint" }, "—")),
          h("td", null, t.kind === "word" ? h("code", null, t.stem) : h("span", { class: "faint" }, "—")))))));
    }),
    codeRef("app/nlu/text.py")));

  // ----------------------------------------------------------- 2. faltas
  const typedIn = h("input", { type: "text", value: "pizas", "aria-label": "Palabra escrita" });
  const knownIn = h("input", { type: "text", value: "pizzas", "aria-label": "Palabra conocida" });
  const editBox = h("div"), delBox = h("div");
  let editTouched = false;  // mientras no se toquen, muestran la primera corrección de la frase
  const drawEdit = () => { clear(editBox).append(editView(typedIn.value, knownIn.value)); clear(delBox).append(deletesView(typedIn.value, knownIn.value)); };
  for (const inp of [typedIn, knownIn]) inp.addEventListener("input", () => { editTouched = true; drawEdit(); });
  content.append(section("faltas", 2,
    "Si una palabra de 4 letras o más no está en el vocabulario del agente (las de sus frases y sinónimos, más las de fechas y números), se cambia por la palabra conocida más parecida.",
    h("p", null, "«Parecida» se mide con la ", h("b", null, "distancia de Damerau-Levenshtein"), ": el número mínimo de operaciones (borrar, insertar o cambiar una letra, o intercambiar dos seguidas) que convierten una palabra en la otra. Se calcula con una tabla en la que cada casilla sale de sus vecinas:"),
    formula("d(i,j) = \\min \\cases{ d(i-1,j)+1 & \\text{borrar } a_i \\\\ d(i,j-1)+1 & \\text{insertar } b_j \\\\ d(i-1,j-1)+[a_i \\ne b_j] & \\text{cambiar} \\\\ d(i-2,j-2)+1 & \\text{intercambiar}^{*} }"),
    legend([["a, b", "la palabra escrita y la conocida (sin tildes)"], ["d(i,j)", "distancia entre las i primeras letras de a y las j primeras de b; d(i,0) = i y d(0,j) = j"], ["[a_i \\ne b_j]", "1 si las letras son distintas, 0 si son iguales (cambiar una letra por sí misma es gratis)"], ["^{*}", ["solo si las dos últimas letras están cruzadas: ", tex("a_{i-1} a_i = b_j b_{j-1}")]]]),
    h("div", { class: "in-try" }, h("label", { class: "field" }, "Escrita", typedIn), h("label", { class: "field" }, "Conocida", knownIn)),
    editBox,
    h("p", null, "Se acepta ", h("b", null, "distancia 1"), " (2 en palabras de 9 letras o más), la ", h("b", null, "primera letra tiene que coincidir"), " (salvo la «h» muda: «abla» → «habla»; sin esta regla, «apaga» se corregía a «paga») y, entre varias candidatas, gana la de menor distancia y, a igualdad, la más frecuente."),
    h("p", null, "Comparar con todo el vocabulario sería lento. El truco de ", h("b", null, "SymSpell"), ": al entrenar se guardan las palabras conocidas y todas sus versiones con una letra borrada; al corregir se generan los borrados de la palabra escrita y solo se comparan las que coinciden en algo."),
    delBox,
    live(() => {
      const fixed = an.tokens.filter((t) => t.corrected);
      if (!fixed.length) return h("div", { class: "muted small" }, "Tu frase no tiene ninguna palabra corregida: todas están en el vocabulario (o son cortas).");
      return h("div", { class: "col", style: { gap: "8px" } }, fixed.map((t) => h("div", null, "«", h("b", null, t.norm), "» → «", h("b", null, t.corrected), "» ",
        h("button", { class: "btn sm ghost", type: "button", onclick: () => { typedIn.value = t.norm; knownIn.value = t.corrected; drawEdit(); } }, "Ver su tabla"))));
    }),
    codeRef("app/nlu/spelling.py")));
  drawEdit();

  // ----------------------------------------------------------- 3. raíces
  content.append(section("raices", 3,
    "Para que «reservar», «reserva» y «reservas» cuenten como la misma palabra, cada una se reduce a su raíz con el algoritmo Snowball para español, adaptado a texto sin tildes.",
    h("p", null, "Snowball no usa diccionario: quita terminaciones conocidas, pero solo si caen dentro de ciertas zonas de la palabra, para no destrozar las cortas:"),
    legend([["\\op{R1}", "lo que va después de la primera consonante que sigue a una vocal"], ["\\op{R2}", "lo mismo, pero contado dentro de R1"],
      ["\\op{RV}", "si la 2.ª letra es consonante, lo que va tras la vocal siguiente; si las dos primeras son vocales, tras la consonante siguiente; si empieza por consonante y vocal, desde la 4.ª letra"]]),
    h("p", null, "Y luego, por pasos: quita los pronombres pegados («dámelo»), los sufijos de sustantivos y adjetivos que caen en R2 (-ción, -mente, -idad…), las terminaciones de verbos que caen en RV (-aríamos, -ando, -ieron…) y, al final, la vocal suelta. Lince añade dos ajustes: trabaja sin tildes (así «cancelación» y «cancelacion» dan la misma raíz) y reduce antes los plurales en -des y -res («ciudades» → «ciud»)."),
    stemView("reservaciones", "reserv"),
    live(() => {
      // (las corregidas llevan la raíz de lo que se escribió, no de la corrección: se dejan fuera)
      const words = an.tokens.filter((t) => t.kind === "word" && !t.corrected && t.norm.length > 3 && t.stem !== t.norm).slice(0, 5);
      if (!words.length) return h("div", { class: "muted small" }, "Ninguna palabra de tu frase cambia al quedarse con la raíz.");
      return h("div", { class: "col", style: { gap: "10px" } }, words.map((t) => stemView(t.norm, t.stem)));
    }),
    codeRef("app/nlu/stemmer_es.py")));

  // ----------------------------------------------------------- 4. entidades
  content.append(section("entidades", 4,
    "Las entidades son los datos dentro de la frase: un número, una fecha, una pizza, un tipo de habitación.",
    h("p", null, "Las ", h("b", null, "del sistema"), " (@sys.number, @sys.date, @sys.time…) las reconocen analizadores escritos a mano sobre los tokens: números en palabras («doscientos treinta»), fechas relativas («el lunes que viene», «del 12 al 15»), horas («a las 5 de la tarde»)… Las ", h("b", null, "propias"), " del agente se buscan en un índice de secuencias de tokens, por orden: forma exacta (confianza 1), raíz (0,95: plurales y género) y forma corregida (0,85)."),
    h("p", null, "Varias pueden pisarse («las dos» puede ser una hora o un número). Se ordenan las candidatas y se van cogiendo las que no pisan a ninguna ya elegida:"),
    formula(["\\text{orden} = \\left( -\\op{tokens},\\ -\\op{letras},\\ \\op{origen},\\ -\\op{confianza},\\ \\op{posición} \\right)",
      "\\text{origen: exacta} > \\text{sistema, raíz} > \\text{número} > \\text{corregida}"]),
    h("p", { class: "small muted" }, "Es decir: gana la que abarca más palabras; a igualdad, la de origen más fiable. Por eso «a las dos» es una hora y no un número suelto."),
    h("p", null, "Después, cada entidad elegida se sustituye por su tipo en los rasgos del paso siguiente: así «una barbacoa» y «una hawaiana» se parecen, porque las dos son «una @pizza»."),
    live(() => spansView(an), "Con tu frase: entidades elegidas (en color) y descartadas"),
    codeRef("app/nlu/sys_entities.py", "app/nlu/entities.py", "app/nlu/common.py")));

  // ----------------------------------------------------------- 5. rasgos
  content.append(section("rasgos", 5,
    "El modelo no lee palabras: lee rasgos. Cada frase se convierte en una lista de rasgos, cada uno con cuántas veces aparece.",
    h("div", { class: "table-scroll" }, h("table", { class: "mini-table stack-sm" },
      h("thead", null, h("tr", null, h("th", null, "Rasgo"), h("th", null, "Ejemplo"), h("th", null, "Para qué"))),
      h("tbody", null,
        h("tr", null, h("td", null, h("code", null, "w:"), " palabra (raíz)"), h("td", null, h("code", null, "w:reserv")), h("td", null, "la pista principal")),
        h("tr", null, h("td", null, h("code", null, "b:"), " pareja seguida"), h("td", null, h("code", null, "b:para_@sys.number")), h("td", null, "el orden: «no quiero» no es «quiero»")),
        h("tr", null, h("td", null, h("code", null, "e:"), " entidad"), h("td", null, h("code", null, "e:@sys.date")), h("td", null, "la estructura, sin el valor concreto")),
        h("tr", null, h("td", null, h("code", null, "c:"), " trozo de 3-4 letras"), h("td", null, h("code", null, "c:<re"), " ", h("code", null, "c:serv")), h("td", null, "tolerar faltas y palabras nuevas")),
        h("tr", null, h("td", null, h("code", null, "p:"), " signo de pregunta"), h("td", null, h("code", null, "p:?")), h("td", null, "distinguir preguntas de órdenes"))))),
    h("p", null, "Las palabras de dentro de una entidad también cuentan, pero la mitad (0,5). El texto libre (", h("code", null, "@sys.any"), ") no se sustituye: al preguntar nunca se detecta, así que entrena como palabras normales. Los números sin entidad son ", h("code", null, "#num"), "."),
    live(() => {
      const groups = ["w", "b", "e", "c", "p"].map((k) => [k, ex.features.filter((f) => f.kind === k)]).filter(([, l]) => l.length);
      return h("div", { class: "col", style: { gap: "10px" } },
        h("div", { class: "small muted" }, `${ex.featureCounts.total} rasgos conocidos`, ex.featureCounts.unknown ? ` (y ${ex.featureCounts.unknown} que el agente no ha visto nunca: no cuentan)` : ""),
        groups.map(([k, list]) => h("div", { class: "feat-group" }, h("div", { class: "fg-title" }, KIND[k] === "letras" ? "trozos de letras" : KIND[k] + "s", h("span", { class: "faint" }, ` · ${list.length}`)),
          h("div", { class: "in-chips" }, list.slice(0, k === "c" ? 28 : 40).map((f) => h("span", { class: "in-chip", title: f.feature },
            f.label, f.count !== 1 ? h("span", { class: "faint" }, ` ×${num(f.count, 1)}`) : null)), k === "c" && list.length > 28 ? h("span", { class: "faint small" }, ` y ${list.length - 28} más`) : null))));
    }),
    codeRef("app/nlu/features.py")));

  // ----------------------------------------------------------- 6. TF-IDF
  content.append(section("tfidf", 6,
    "No todos los rasgos valen lo mismo: «quiero» sale en casi todas las intenciones y no ayuda a distinguir; «barbacoa» sale en una sola y lo dice todo. TF-IDF da a cada rasgo un peso.",
    formula(["\\op{tf}(f) = 1 + \\ln n_f", "\\op{idf}(f) = \\ln \\frac{1 + K}{1 + \\op{df}(f)} + 1"]),
    formula(["x_f = \\frac{\\op{tf}(f) \\cdot \\op{idf}(f)}{\\left\\| \\op{tf} \\cdot \\op{idf} \\right\\|_2}", "\\mathbf{x} = \\sqrt{0,55}\\; \\mathbf{x}_{\\text{palabras}} \\oplus \\sqrt{0,45}\\; \\mathbf{x}_{\\text{letras}}"]),
    legend([["n_f", "cuántas veces aparece el rasgo en la frase (0,5 si está dentro de una entidad)"], ["K", `número de intenciones que se distinguen (${classes} en este agente; cada fallback con ejemplos cuenta como una)`],
      ["\\op{df}(f)", "en cuántas de esas intenciones aparece el rasgo"], ["\\|\\cdot\\|_2", "longitud del vector: se divide para que mida 1 (normalización L2), por separado en cada bloque"], ["\\oplus", "pegar los dos bloques en un solo vector"]]),
    h("p", null, "El IDF se calcula ", h("b", null, "por intención y no por frase"), ": una palabra que se repite en muchas frases de la misma intención sigue pesando mucho. Y como cada bloque mide 1, el vector entero también mide 1, y el coseno entre dos frases (paso 8) es ", tex("0,55\\, \\cos_{\\text{palabras}} + 0,45\\, \\cos_{\\text{letras}}"), "."),
    live(() => [h("div", { class: "small muted" }, "Dónde caen las palabras y entidades de tu frase en la curva del IDF: cuanto más a la izquierda (en menos intenciones salen), más pesan."),
      idfFigure(Math.max(2, classes), ex.features),
      h("div", { class: "small muted", style: { marginTop: "6px" } }, "Los rasgos de tu frase con más peso al final:"),
      barList({ items: ex.features.slice(0, 10).map((f) => ({ label: f.label, sub: KIND[f.kind], value: f.weight, tip: `tf ${num(f.count > 0 ? (f.count >= 1 ? 1 + Math.log(f.count) : f.count) : 0)} × idf ${num(f.idf)} → ${num(f.weight, 3)}` })), format: (v) => num(v, 3), labelWidth: 170 })]),
    codeRef("app/nlu/classifier.py: Vectorizer")));

  // ----------------------------------------------------------- 7. regresión
  const lrChart = (() => {
    const W = 300, H = 120, m = { l: 34, r: 26, t: 10, b: 26 };
    const X = (t) => m.l + (t / 14) * (W - m.l - m.r), Y = (v) => m.t + (H - m.t - m.b) * (1 - v / 0.5);
    const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart-svg in-chart small-chart", role: "img", "aria-label": "Tasa de aprendizaje por época" });
    for (const v of [0, 0.25, 0.5]) svg.append(sv("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: "grid" }), sv("text", { x: m.l - 5, y: Y(v) + 4, class: "tick", "text-anchor": "end" }, num(v, 2)));
    for (const t of [0, 7, 14]) svg.append(sv("text", { x: X(t), y: H - 8, class: "tick", "text-anchor": "middle" }, `época ${t + 1}`));
    svg.append(sv("polyline", { points: Array.from({ length: 15 }, (_, t) => `${X(t)},${Y(0.5 / (1 + 0.02 * t))}`).join(" "), class: "line" }));
    return svg;
  })();
  content.append(section("regresion", 7,
    "Con la frase convertida en el vector x, el modelo da una puntuación a cada intención y la convierte en probabilidades. Es una regresión logística multiclase (softmax), la base de muchos modelos de lenguaje.",
    formula(["z_k = b_k + \\sum_f x_f\\, W_{f,k}", "p_k = \\frac{e^{z_k}}{\\sum_j e^{z_j}}"]),
    legend([["W_{f,k}", "el peso que ha aprendido el rasgo f para la intención k (positivo: empuja hacia ella; negativo: aleja)"], ["b_k", "punto de partida (sesgo) de cada intención"], ["z_k", "puntuación de la intención k"], ["p_k", "probabilidad (softmax): todas suman 1 y la mayor puntuación se lleva la mayor parte"]]),
    h("h3", null, "Cómo aprende los pesos"),
    h("p", null, "Al entrenar repasa las frases una a una, en orden aleatorio (con semilla fija, así sale siempre igual), durante 15 épocas. Con cada frase mide lo mal que lo ha hecho con la ", h("b", null, "entropía cruzada"), " y mueve los pesos un poco en la dirección que más reduce ese error (", h("b", null, "descenso por gradiente estocástico"), ", SGD):"),
    formula(["L = -\\ln p_y + \\frac{\\lambda}{2} \\|W\\|^2", "\\frac{\\partial L}{\\partial z_k} = p_k - [k = y]"]),
    formula(["W_{f,\\cdot} \\gets W_{f,\\cdot} - \\eta_t \\left( x_f (\\mathbf{p} - \\mathbf{e}_y) + \\lambda W_{f,\\cdot} \\right)", "\\mathbf{b} \\gets \\mathbf{b} - \\eta_t (\\mathbf{p} - \\mathbf{e}_y)"]),
    legend([["y", "la intención correcta de la frase"], ["\\mathbf{e}_y", "vector con un 1 en la intención correcta y 0 en las demás"], ["\\lambda", "regularización L2 (10⁻⁴): evita pesos enormes que se aprenden de memoria las frases"],
      ["\\eta_t", ["tasa de aprendizaje en la época t: empieza en 0,5 y baja poco a poco, ", tex("\\eta_t = 0,5 / (1 + 0,02\\, t)")]]]),
    h("div", { class: "row wrap in-pair" }, lrChart, h("p", { class: "small muted" }, "La regla es muy intuitiva: si la intención correcta tenía probabilidad 0,7, su peso sube en proporción a 0,3 (lo que le faltaba) para cada rasgo de la frase; y las que se llevaron probabilidad sin merecerla, bajan. Los rasgos que no están en la frase (", tex("x_f = 0"), ") no se tocan, así que cada paso es rapidísimo.")),
    live(() => {
      const c = ex.contributions[0];
      if (!c) return h("div", { class: "muted small" }, "No hay intenciones con frases para puntuar.");
      return [h("div", { class: "small muted" }, "Así se suma la puntuación de «", h("b", null, c.name), "» con tu frase: cada barra es un rasgo × su peso."),
        waterfall(c), softmaxView()];
    }),
    codeRef("app/nlu/classifier.py: IntentClassifier.fit")));

  function softmaxView() {
    const cs = ex.contributions;
    const top = ex.ranking.find((r) => r.id === cs[0].id);
    if (!top || !top.lr) return null;
    const total = Math.exp(cs[0].score) / top.lr;  // Σ_j e^{z_j}, despejado de p₁ = e^{z₁}/Σ
    const rows = cs.map((c) => ({ name: c.name, z: c.score, ez: Math.exp(c.score) }));
    const rest = Math.max(0, total - rows.reduce((s, r) => s + r.ez, 0));
    const others = Math.max(0, eligible - rows.length);
    if (others) rows.push({ name: `las otras ${others}`, z: null, ez: rest });
    return h("div", { class: "softmax" },
      h("div", { class: "small muted" }, "Y el softmax reparte la probabilidad (sin el parecido, que se suma en el paso 8):"),
      h("div", { class: "table-scroll" }, h("table", { class: "mini-table" },
        h("thead", null, h("tr", null, h("th", null, "Intención"), h("th", { class: "num plain" }, tex("z")), h("th", { class: "num plain c-ez" }, tex("e^{z}")),
          h("th", { class: "plain" }, tex("p = e^{z} / \\sum")))),
        h("tbody", null, rows.map((r) => h("tr", null, h("td", null, r.name), h("td", { class: "num" }, r.z == null ? "…" : num(r.z)),
          h("td", { class: "num c-ez" }, num(r.ez, r.ez < 10 ? 2 : 1)),
          h("td", null, h("div", { class: "row", style: { gap: "8px" } }, h("div", { class: "meter small-meter grow" }, h("div", { class: "meter-fill", style: { width: (100 * r.ez / total).toFixed(1) + "%" } })), h("b", { class: "tnum" }, pct(r.ez / total)))))),
        h("tr", { class: "sum" }, h("td", null, "Σ"), h("td"), h("td", { class: "num c-ez" }, num(total, 1)), h("td", null, "100\u00a0%"))))));
  }

  // ----------------------------------------------------------- 8. parecido
  content.append(section("parecido", 8,
    "La regresión logística siempre reparte el 100\u00a0%, aunque la frase no se parezca a nada que conozca el agente. Por eso también se mide cuánto se parece de verdad a sus frases de entrenamiento.",
    formula("\\cos(\\mathbf{x}, \\mathbf{y}) = \\frac{\\mathbf{x} \\cdot \\mathbf{y}}{\\|\\mathbf{x}\\|\\, \\|\\mathbf{y}\\|} = \\sum_f x_f\\, y_f"),
    h("p", null, "Como todos los vectores miden 1, el coseno es solo la suma de los productos de los rasgos que comparten (y un índice invertido permite mirar solo las frases que tienen algún rasgo en común). 1 = misma dirección; 0 = nada en común. Para cada intención:"),
    formula("\\op{sim}_k = \\max\\left( 0,7\\, s_k^{(1)} + 0,3\\, s_k^{(2)},\\ \\cos(\\mathbf{x}, \\mathbf{c}_k) \\right)"),
    legend([["s_k^{(1)}, s_k^{(2)}", "el coseno con las dos frases de la intención k más parecidas"], ["\\mathbf{c}_k", "el centroide de la intención: la media de sus frases, normalizada"]]),
    h("p", null, "Con pocas frases, el vecino más parecido es una pista muy fiable, así que se mezcla con la probabilidad del modelo (un 15\u00a0%):"),
    formula("p_k = 0,85\\, p_k^{\\text{LR}} + 0,15\\, \\frac{e^{\\op{sim}_k / 0,1}}{\\sum_j e^{\\op{sim}_j / 0,1}}"),
    live(() => {
      const nb = ex.neighbors || [];
      const best = an.ranking[0];
      const out = [];
      if (nb.length) {
        out.push(h("div", { class: "row wrap in-pair" }, cosineView(nb[0].similarity),
          h("div", { class: "grow col", style: { gap: "6px", minWidth: "min(100%, 300px)" } }, h("div", { class: "small muted" }, "Las frases de entrenamiento más parecidas a la tuya (el coseno):"),
            barList({ items: nb.slice(0, 5).map((n) => ({ label: `“${n.text}”`, value: n.similarity, tip: n.intentName })), max: 1, format: (v) => num(v, 2), labelWidth: 180 }))));
      }
      if (best && best.lr != null) {
        const knn = (best.prob - 0.85 * best.lr) / 0.15;
        out.push(h("div", { class: "formula live-formula" }, tex(`p_{\\text{${clean(best.name)}}} = 0,85 \\cdot ${num(best.lr, 3)} + 0,15 \\cdot ${num(knn, 3)}`, { display: true }),
          tex(`= ${num(best.prob, 3)}`, { display: true })));
      }
      return out;
    }),
    codeRef("app/nlu/classifier.py: IntentClassifier.predict")));

  // ----------------------------------------------------------- 9. confianza
  const thr = agent ? (agent.settings || {}).threshold ?? 0.3 : 0.3;
  const pIn = h("input", { type: "range", min: "0", max: "1", step: "0.01", value: "0.8", "aria-label": "Probabilidad" });
  const sIn = h("input", { type: "range", min: "0", max: "1", step: "0.01", value: "0.5", "aria-label": "Parecido" });
  const mapBox = h("div", { class: "conf-wrap" }), youBox = h("div", { class: "formula live-formula conf-calc" });
  const drawConf = () => {
    const you = { prob: +pIn.value, sim: +sIn.value };
    const pts = an ? an.ranking.filter((r) => !r.isFallback).slice(0, 5) : [];
    clear(mapBox).append(confidenceMap(thr, pts, you));
    const c = conf(you.prob, you.sim);
    clear(youBox).append(tex(`\\op{conf} = \\sqrt{${num(you.prob)}} \\cdot \\min\\left(1, \\frac{${num(you.sim)}}{0,65}\\right)^2`, { display: true }),
      tex(`= ${num(Math.sqrt(you.prob))} \\cdot ${num(simFactor(you.sim))} = ${num(c)} ${c >= thr ? "\\ge" : "<"} ${num(thr)}`, { display: true }),
      h("div", { class: "status" }, h("span", { class: "status-icon " + (c >= thr ? "good" : "critical") }, c >= thr ? "✓" : "✗"), c >= thr ? "responde esa intención" : "respondería el fallback"));
  };
  let confTouched = false;  // mientras no se toquen, las barras están en la intención ganadora de la frase
  for (const inp of [pIn, sIn]) inp.addEventListener("input", () => { confTouched = true; drawConf(); });
  content.append(section("confianza", 9,
    "La probabilidad dice qué intención es la más probable; la confianza dice si fiarse. Si no llega al umbral, responde el fallback («no te he entendido»).",
    formula("\\op{conf}_k = \\sqrt{p_k} \\cdot \\min\\left(1, \\frac{\\op{sim}_k}{0,65}\\right)^2"),
    h("p", null, "La raíz suaviza la probabilidad (0,5 → 0,71) y el segundo factor castiga a las frases que no se parecen a ninguna conocida: por encima de 0,65 de parecido no resta nada; por debajo, multiplica por ", tex("(\\op{sim}/0,65)^2"), ". Sin él, con pocas intenciones, una frase fuera de tema podía sacar un 90\u00a0% de probabilidad. Se calibró con las frases de prueba de la pizzería para un umbral de 0,3."),
    h("div", { class: "row wrap in-pair conf-pair" }, mapBox,
      h("div", { class: "grow col", style: { gap: "10px", minWidth: "230px" } },
        h("div", { class: "small muted" }, "El color es la confianza y la línea, el umbral del agente (", num(thr), "). Los puntos son las intenciones candidatas de tu frase y el círculo, los valores de las barras (al principio, los de la ganadora). Muévelas para probar:"),
        h("label", { class: "field" }, "Probabilidad p", pIn), h("label", { class: "field" }, "Parecido sim", sIn), youBox)),
    h("p", null, "Dos ajustes más: si la frase coincide exactamente con una de entrenamiento, la confianza es 1; y las intenciones que esperaban un contexto activo reciben ", tex("\\min(1,\\ 1,15 \\cdot \\op{conf} + 0,05)"), " (paso 10)."),
    codeRef("app/nlu/engine.py: NLUEngine.confidence")));

  // ----------------------------------------------------------- 10. decisión
  content.append(section("decision", 10,
    "Con las probabilidades y las confianzas, el motor decide. Se elige por probabilidad (es más precisa: 3 puntos más en el benchmark MASSIVE que ordenar por confianza) y se acepta por confianza.",
    h("ol", { class: "in-steps" },
      h("li", null, h("b", null, "Contextos."), " Solo compiten las intenciones cuyos contextos de entrada están todos activos: un «sí» suelto no activa «pedido.bebida.si» si nadie ha preguntado nada."),
      h("li", null, h("b", null, "Plantillas."), " Si la frase coincide exactamente con una de entrenamiento (las entidades cuentan por su tipo y ", h("code", null, "@sys.any"), " es un comodín), su intención gana con confianza 1. Un comodín no se impone si el modelo ve más probable un ejemplo negativo del fallback."),
      h("li", null, h("b", null, "Orden."), " Primero las de contexto con confianza ≥ 0,5; después las coincidencias exactas; después, por probabilidad."),
      h("li", null, h("b", null, "Umbral."), " Si la primera es el fallback (ganan los ejemplos negativos) o su confianza no llega al umbral, responde el fallback.")),
    formula(["k^{*} = \\argmax_{k\\, \\in\\, \\text{candidatas}} p_k", "\\text{responde } k^{*} \\text{ si } \\op{conf}_{k^{*}} \\ge \\text{umbral}"]),
    live(() => {
      const best = an.ranking[0];
      if (!best) return h("div", { class: "muted small" }, "El agente no tiene intenciones con frases.");
      const ok = an.accepted;
      return h("ol", { class: "in-steps trace" },
        h("li", null, `Compiten ${eligible} intenciones (sin contextos activos en esta prueba).`),
        h("li", null, an.template ? ["Coincide exactamente con una frase de entrenamiento: confianza 100\u00a0%."] : "No coincide exactamente con ninguna frase: decide el modelo."),
        h("li", null, "Gana «", h("b", null, best.name), "» con p = ", num(best.prob, 3), best.isFallback ? " (son los ejemplos negativos del fallback)" : ""),
        h("li", null, "Confianza ", h("b", null, pct(best.confidence)), ok ? " ≥ " : " < ", "umbral ", pct(an.threshold), ok ? ": ✓ responde esta intención." : ": ✗ responde el fallback."));
    }),
    codeRef("app/nlu/engine.py: NLUEngine.analyze")));

  // ----------------------------------------------------------- 11. parámetros
  content.append(section("parametros", 11,
    "Con la intención decidida, se rellenan sus parámetros con las entidades de la frase.",
    h("p", null, "Si hubo plantilla exacta, los valores salen de ella. Si no, cada parámetro toma las entidades de su tipo que no estén dentro de otra. Cuando hay ", h("b", null, "varios del mismo tipo"), " («para 3 noches para 2 personas»: dos @sys.number), se reparten por lo que cada parámetro solía llevar a los lados en las frases anotadas:"),
    formula("\\op{puntos}(c, \\pi) = \\frac{L_{\\pi}[\\op{izq}(c)] + R_{\\pi}[\\op{der}(c)]}{N_{\\pi}}"),
    legend([["c", "una entidad candidata de la frase"], ["\\pi", "un parámetro (por ejemplo, noches)"], ["L_{\\pi}[u], R_{\\pi}[u]", "cuántas veces el parámetro llevaba u justo a la izquierda o a la derecha en las anotaciones (u es una raíz o un tipo de entidad)"], ["N_{\\pi}", "cuántas veces se anotó el parámetro"]]),
    h("div", { class: "table-scroll" }, h("table", { class: "mini-table" },
      h("thead", null, h("tr", null, h("th", null, "Candidata"), h("th", null, "A los lados"), h("th", { class: "num" }, "noches"), h("th", { class: "num" }, "huéspedes"), h("th", null, "Se queda en"))),
      h("tbody", null,
        h("tr", null, h("td", null, h("b", null, "3")), h("td", null, "para · ", h("b", null, "noches")), h("td", { class: "num" }, "0,9"), h("td", { class: "num" }, "0,4"), h("td", null, "noches")),
        h("tr", null, h("td", null, h("b", null, "2")), h("td", null, "para · ", h("b", null, "personas")), h("td", { class: "num" }, "0,3"), h("td", { class: "num" }, "1,0"), h("td", null, "huéspedes"))))),
    h("p", { class: "small muted" }, "(Números de ejemplo: «para» va delante de los dos, pero «noches» y «personas» detrás deciden.) Un «un/una» suelto solo es el número 1 si lo de detrás encaja (", tex("R_{\\pi}[\\op{der}(c)] > 0"), "): «una noche» rellena las noches; «una habitación», no. El texto libre (", h("code", null, "@sys.any"), ") se captura entre las palabras que lo rodeaban en las frases anotadas («me llamo [X]») y se recorta antes de otro dato de la intención y sin muletillas delante («oye, …»)."),
    live(() => {
      const ps = Object.entries(an.parameters || {});
      const best = an.ranking[0];
      if (!best || best.isFallback || !an.accepted) return h("div", { class: "muted small" }, "Tu frase va al fallback: no hay parámetros que rellenar.");
      if (!ps.length) return h("div", { class: "muted small" }, "«", best.name, "» no tiene parámetros, o tu frase no trae ninguno.");
      return h("div", { class: "in-chips" }, ps.map(([k, v]) => h("span", { class: "in-chip param" }, h("b", null, "$" + k), " = ", Array.isArray(v) ? v.join(", ") : String(v))));
    }),
    codeRef("app/nlu/engine.py: extract_parameters")));

  // ----------------------------------------------------------- 12. conversación
  content.append(section("dialogo", 12,
    "Todo lo anterior entiende una frase suelta. La conversación la lleva el gestor de diálogo, turno a turno, con memoria: los contextos y la pregunta pendiente.",
    dialogFlow(),
    h("p", null, "Los ", h("b", null, "contextos"), " son la memoria: una intención los pone al responder, con una duración en turnos, y las intenciones que los esperan solo compiten mientras siguen activos. Al final de cada turno los que ya estaban pierden 1, los que se ponen en ese turno empiezan con su duración completa y al llegar a 0 desaparecen:"),
    contextsTimeline(),
    h("p", { class: "small muted" }, "La respuesta se elige al azar entre sus variantes, sin repetir la que dio esa intención la vez anterior en la misma conversación. Los valores de los parámetros se escriben con formato («viernes 2 de octubre», «21:30») y, si hay webhook, se le manda la misma petición que mandaría Dialogflow."),
    codeRef("app/dialog.py")));

  // ----------------------------------------------------------- 13. mapa
  content.append(section("mapa", 13,
    "En la página Entrenar cada frase de entrenamiento es un punto de un mapa: las que el modelo ve parecidas quedan juntas. Para pasar de muchas dimensiones (una puntuación por intención) a dos se usa t-SNE.",
    h("p", null, "t-SNE convierte las distancias en probabilidades de «ser vecinas» y busca un mapa en 2D donde esas probabilidades se parezcan lo más posible:"),
    formula(["p_{j|i} = \\frac{e^{-\\beta_i \\|\\mathbf{x}_i - \\mathbf{x}_j\\|^2}}{\\sum_{k \\ne i} e^{-\\beta_i \\|\\mathbf{x}_i - \\mathbf{x}_k\\|^2}}", "p_{ij} = \\frac{p_{j|i} + p_{i|j}}{2n}"]),
    formula(["q_{ij} = \\frac{\\left(1 + \\|\\mathbf{y}_i - \\mathbf{y}_j\\|^2\\right)^{-1}}{\\sum_{k \\ne l} \\left(1 + \\|\\mathbf{y}_k - \\mathbf{y}_l\\|^2\\right)^{-1}}", "\\op{KL}(P \\| Q) = \\sum_{i \\ne j} p_{ij} \\ln \\frac{p_{ij}}{q_{ij}}"]),
    formula("\\frac{\\partial\\, \\op{KL}}{\\partial \\mathbf{y}_i} = 4 \\sum_j (p_{ij} - q_{ij})\\, (\\mathbf{y}_i - \\mathbf{y}_j) \\left(1 + \\|\\mathbf{y}_i - \\mathbf{y}_j\\|^2\\right)^{-1}"),
    legend([["\\mathbf{x}_i", "las puntuaciones del modelo para la frase i (centradas)"], ["\\mathbf{y}_i", "la posición del punto en el mapa"], ["\\beta_i", ["lo estrecha que es la campana de cada frase: se busca (por bisección, para todas a la vez) que tenga unas 20 vecinas efectivas, la perplejidad ", tex("e^{H_i} = 20"), ", con ", tex("H_i = -\\sum_j p_{j|i} \\ln p_{j|i}")]], ["\\op{KL}", "divergencia de Kullback-Leibler: cuánto se equivoca el mapa; se minimiza con el gradiente"]]),
    h("div", { class: "row wrap in-pair" }, kernelsFigure(), h("p", { class: "small muted" }, "En el mapa se usa una t de Student en vez de una campana de Gauss: tiene las colas más largas, así que dos frases algo distintas pueden quedar más lejos de lo que estaban y los grupos se separan en vez de amontonarse en el centro.")),
    h("p", null, "Detalles: 400 iteraciones con impulso (0,5 y luego 0,8), las 100 primeras con «exageración» ×4 para separar antes los grupos, semilla fija y, al final, una repulsión corta que separa los puntos que caen uno encima de otro. Las distancias se calculan con la matriz de Gram, ", tex("\\|\\mathbf{a} - \\mathbf{b}\\|^2 = \\|\\mathbf{a}\\|^2 + \\|\\mathbf{b}\\|^2 - 2\\, \\mathbf{a} \\cdot \\mathbf{b}"), ", sin crear tablas gigantes: con 700 frases tarda unos 2 segundos."),
    codeRef("app/nlu/insights.py: projection")));

  // ----------------------------------------------------------- 14. examen
  content.append(section("examen", 14,
    "Acertar las frases que ya conoce no demuestra nada: se las sabe de memoria. El examen mide cómo le va con frases que no ha visto.",
    h("p", null, h("b", null, "Validación cruzada en 5 rondas"), ": se reparten las frases de cada intención en 5 grupos; en cada ronda se esconde uno, se entrena un modelo nuevo con el resto y se examina con el escondido. Al final todas las frases se han examinado una vez."),
    kfold(),
    formula(["\\text{acierto} = \\frac{\\text{bien}}{\\text{total}}", "\\text{precisión}_k = \\frac{\\op{VP}_k}{\\op{VP}_k + \\op{FP}_k}", "\\text{cobertura}_k = \\frac{\\op{VP}_k}{\\op{VP}_k + \\op{FN}_k}"]),
    legend([["\\op{VP}_k", "frases de k que entendió como k (la diagonal de la matriz de confusión)"], ["\\op{FP}_k", "frases de otras intenciones que entendió como k (su columna, fuera de la diagonal)"], ["\\op{FN}_k", "frases de k que entendió como otra cosa (su fila, fuera de la diagonal)"]]),
    note("Es una estimación ", h("b", null, "prudente"), ": si una frase escondida era la única de su estilo, el modelo duda, se queda por debajo del umbral y cuenta como fallo aunque eligiera bien. Con frases tan variadas como las del hotel da un 65\u00a0%, mientras que con frases nuevas escritas aparte acierta el 91,5\u00a0%. Sirve sobre todo para comparar: si cambias algo y sube, vas bien."),
    codeRef("app/nlu/insights.py: evaluate")));

  content.append(h("div", { class: "card in-sec" }, h("div", { class: "card-body" },
    h("p", { style: { margin: 0 } }, "Para seguir: en ", h("b", null, "Entrenar"), " puedes ver el entrenamiento animado, lo que ha aprendido cada intención, el mapa y el examen de tu agente; en el ", h("b", null, "Analizador"), ", cualquier frase con todos sus detalles. Y la referencia técnica completa (con las decisiones y las alternativas que se descartaron) está en ",
      h("a", { href: "https://github.com/pablomise004/agenteconversacional/blob/main/CONTRIBUTING.md", target: "_blank", rel: "noopener" }, "CONTRIBUTING.md"), "."))));

  // ------------------------------------------------------------- en vivo
  function drawPills() {
    const set = (id, v) => clear(pills.get(id)).append(v);
    const best = an.ranking[0];
    const fixed = an.tokens.filter((t) => t.corrected);
    const stemmed = an.tokens.find((t) => t.kind === "word" && !t.corrected && t.stem !== t.norm && t.norm.length > 3);
    set("tokens", `${an.tokens.length} tokens`);
    set("faltas", fixed.length ? `${fixed[0].norm} → ${fixed[0].corrected}` : "ninguna");
    set("raices", stemmed ? `${stemmed.norm} → ${stemmed.stem}` : "sin cambios");
    set("entidades", an.entities.length ? an.entities.map((e) => e.entity).join(", ") : "ninguna");
    set("rasgos", `${ex.featureCounts.total} rasgos`);
    set("tfidf", ex.features[0] ? `«${ex.features[0].label}» ${num(ex.features[0].weight, 2)}` : "—");
    set("regresion", best ? `${best.name} ${pct(best.lr ?? best.prob)}` : "—");
    set("parecido", best ? `sim ${num(best.sim, 2)}` : "—");
    set("confianza", best ? `${pct(best.confidence)} ${best.confidence >= an.threshold ? "≥" : "<"} ${pct(an.threshold)}` : "—");
    set("decision", an.accepted ? best.name : "fallback");
    const np = Object.keys(an.parameters || {}).length;
    set("parametros", np ? `${np} ${np === 1 ? "parámetro" : "parámetros"}` : "ninguno");
  }

  async function run() {
    if (!agent) return;
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    await busy(runBtn, async () => {
      try {
        [ex, an] = await Promise.all([api.explain(agent.id, text), api.analyze(agent.id, text)]);
      } catch (e) { errorToast(e); return; }
      if (!editTouched) {
        const fixed = an.tokens.find((t) => t.corrected);
        if (fixed) { typedIn.value = fixed.norm; knownIn.value = fixed.corrected; drawEdit(); }
      }
      const top = an.ranking.find((r) => !r.isFallback);
      if (!confTouched && top) { pIn.value = String(top.prob); sIn.value = String(top.sim); }
      drawPills();
      drawers.forEach((fn) => fn());
      drawConf();
    });
  }
  drawConf();
  if (agent) run();

  // resalta en el índice la sección que se está leyendo
  const main = el.closest(".main");
  let frame = 0;
  const spy = () => {
    frame = 0;
    if (!main) return;
    const top = main.getBoundingClientRect().top + 120;
    let current = SECTIONS[0][0];
    for (const [id] of SECTIONS) {
      const node = document.getElementById("in-" + id);
      if (node && node.getBoundingClientRect().top <= top) current = id;
    }
    for (const [id, a] of links) a.classList.toggle("active", id === current);
  };
  const onScroll = () => { if (!frame) frame = requestAnimationFrame(spy); };
  if (main) main.addEventListener("scroll", onScroll, { passive: true });
  spy();
  return { destroy: () => { if (main) main.removeEventListener("scroll", onScroll); } };
}
