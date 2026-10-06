// Vistas de machine learning que comparten las páginas de un modelo y de probarlo: por qué ha dicho lo que
// ha dicho (según el algoritmo), lo que ve la red neuronal por dentro y cómo se prepara una fila.
import { h, icon } from "./ui.js";
import { barList, divergingBars, columnChart, nf } from "./charts.js";
import { treeDiagram, saliencyOverlay, pixelImage, fmt } from "./ml-charts.js";
import { fmtNum } from "./ml-common.js";

const q = (s) => `«${s}»`;

/** Probabilidad de cada clase, de mayor a menor. */
export function probabilityBars(probs, { max = 8 } = {}) {
  const items = Object.entries(probs).sort((a, b) => b[1] - a[1]).slice(0, max);
  return h("div", { class: "prob-list", role: "list", "aria-label": "Probabilidad de cada clase" }, items.map(([c, v], i) =>
    h("div", { class: "prob-row" + (i === 0 ? " top" : ""), role: "listitem" },
      h("span", { class: "prob-name", title: c }, c),
      h("span", { class: "prob-track" }, h("span", { class: "prob-fill", style: { width: (v * 100).toFixed(1) + "%" } })),
      h("span", { class: "prob-val" }, nf(1).format(v * 100) + " %"))));
}

// el árbol solo por el camino que ha seguido la fila: las ramas de al lado, cerradas
function prunePath(node) {
  if (!node.children) return node;
  return { ...node, children: node.children.map((c) => (c.on ? prunePath(c) : { ...c, children: undefined, more: !!(c.children || c.more) })) };
}

function questionText(qq) {
  return qq.category != null ? `¿${qq.column} es ${q(qq.category)}?` : `¿${qq.column} ≤ ${fmt(qq.threshold, 2)}?`;
}

/**
 * Por qué ha dicho eso: la explicación de una predicción (algorithms.py → explain()).
 * ctx: { task, classes, prediction, target }
 */
export function explanationView(ex, ctx) {
  if (!ex || !ex.kind) return null;
  const out = h("div", { class: "col", style: { gap: "12px" } });
  const p = (...c) => out.append(h("p", { style: { margin: 0 } }, ...c));
  if (ex.kind === "baseline") {
    p("La línea base no mira tus datos: dice siempre lo más frecuente del entrenamiento. Sirve de referencia para los demás.");
  } else if (ex.kind === "additive") {
    const items = ex.contributions.filter((c) => Math.abs(c.value) > 1e-9).slice(0, 12)
      .map((c) => ({ label: c.feature, value: c.value, tip: c.feature }));
    if (ex.units === "log") {
      p("Naive Bayes compara las dos clases más probables, ", h("b", null, q(ex.class)), " y ", h("b", null, q(ex.versus)),
        ": cada columna da su voto (lo probable que es su valor en cada clase) y se suman. Empieza con lo frecuente que es cada clase (",
        fmt(ex.start, 2), ") y acaba en ", h("b", null, fmt(ex.total, 2)), " a favor de ", q(ex.class), ".");
      out.append(divergingBars({ items, legend: [`a favor de ${q(ex.class)}`, `a favor de ${q(ex.versus)}`], format: (v) => (v > 0 ? "+" : "") + nf(2).format(v) }));
    } else if (ex.class != null) {
      p("Cada clase tiene una puntuación: su punto de partida más cada columna multiplicada por su peso. ", h("b", null, q(ex.class)),
        ` empieza en ${fmt(ex.start, 2)} y acaba en `, h("b", null, fmt(ex.total, 2)), ", la más alta. Lo que más ha pesado:");
      out.append(divergingBars({ items, legend: [`empuja hacia ${q(ex.class)}`, "le resta"], format: (v) => (v > 0 ? "+" : "") + nf(2).format(v) }));
    } else {
      p("Empieza en la ", ex.startLabel || "media", ` (${fmtNum(ex.start)}) y cada columna suma o resta según su valor y su peso: `,
        "acaba en ", h("b", null, fmtNum(ex.total)), ".");
      out.append(divergingBars({ items, legend: ["sube la predicción", "la baja"], format: (v) => (v > 0 ? "+" : "") + fmtNum(v) }));
    }
  } else if (ex.kind === "path") {
    p("El árbol ha ido haciendo preguntas sobre tu fila hasta llegar a una hoja:");
    const steps = h("div", { class: "why-steps" }, ex.steps.map((s, i) => {
      const yes = s.question.category != null ? !s.answer : s.answer;  // en una categoría, «izquierda» es «no»
      const value = s.question.category != null ? (s.value > 0.5 ? "sí" : "no") : fmtNum(s.value);
      return h("div", { class: "why-step", style: { "--i": i } }, h("span", { class: "n" }, String(i + 1)),
        h("span", null, questionText(s.question), h("span", { class: "muted" }, ` · tu fila: ${value}`)),
        h("span", { class: "ans " + (yes ? "yes" : "no") }, yes ? "sí" : "no"));
    }), h("div", { class: "why-step leaf", style: { "--i": ex.steps.length } }, h("span", { class: "n" }, icon("check")),
      h("span", null, "Respuesta de la hoja: ", h("b", null, ctx.task === "regression" ? fmtNum(ctx.prediction) : q(ctx.prediction))), h("span")));
    out.append(steps);
    if (ex.tree) out.append(h("div", { class: "chart-title", style: { marginTop: "4px" } }, "El camino en el árbol"),
      treeDiagram({ tree: prunePath(ex.tree), task: ctx.task, depth: 20 }));
  } else if (ex.kind === "votes") {
    const items = [...ex.votes].sort((a, b) => b.votes - a.votes).map((v) => ({ label: v.class, value: v.votes, tip: `${v.votes} de ${ex.trees} árboles` }));
    p(`Cada uno de los ${ex.trees} árboles ha dado su respuesta; gana la que más votos tiene (en realidad se promedian las probabilidades de cada árbol, que casi siempre da lo mismo).`);
    out.append(barList({ items, max: ex.trees, format: (v) => `${v} de ${ex.trees}`, labelWidth: 130 }));
  } else if (ex.kind === "spread") {
    p(`Cada uno de los ${ex.trees} árboles ha calculado su número; la predicción es la media: `, h("b", null, fmtNum(ex.mean)),
      `. El más bajo dijo ${fmtNum(ex.min)} y el más alto, ${fmtNum(ex.max)}: cuanto más de acuerdo estén, más fiable.`);
    const bins = 10, lo = ex.min, hi = ex.max, w = (hi - lo) / bins || 1;
    const counts = new Array(bins).fill(0);
    ex.values.forEach((v) => { counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++; });
    out.append(columnChart({ data: counts.map((c, i) => ({ x: fmtNum(lo + i * w), value: c, title: `${c} árboles`, tip: `de ${fmtNum(lo + i * w)} a ${fmtNum(lo + (i + 1) * w)}` })),
      label: "Lo que dijo cada árbol", every: 3, width: 420, height: 150 }));
  } else if (ex.kind === "neighbors") {
    const n = ex.neighbors.length;
    if (ctx.task === "classification") {
      const counts = {};
      ex.neighbors.forEach((v) => { counts[v.label] = (counts[v.label] || 0) + 1; });
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      p(`Ha buscado las ${n} filas de entrenamiento más parecidas a la tuya: ${top[1]} de ellas son `, h("b", null, q(top[0])), ".");
    } else {
      p(`Ha buscado las ${n} filas de entrenamiento más parecidas a la tuya y ha hecho la media de su «${ctx.target}».`);
    }
    out.append(h("div", { class: "table-wrap" }, h("table", { class: "table neighbors-table" },
      h("thead", null, h("tr", null, h("th", { class: "num" }, "#"), h("th", null, "Fila de la tabla"), h("th", { class: "num" }, "Distancia"),
        h("th", null, ctx.task === "classification" ? "Su clase" : `Su «${ctx.target}»`))),
      h("tbody", null, ex.neighbors.map((v, i) => h("tr", null, h("td", { class: "num muted" }, String(i + 1)),
        h("td", null, v.row != null ? `fila ${nf(0).format(v.row + 1)}` : "—"), h("td", { class: "num" }, fmt(v.distance, 3)),
        h("td", { class: "lbl" }, ctx.task === "classification" ? v.label : fmtNum(v.value))))))));
    out.append(h("p", { class: "muted small", style: { margin: 0 } }, "La distancia se mide con los números ya escalados: todas las columnas pesan parecido."));
  } else if (ex.kind === "centroids") {
    p("Cada grupo tiene un centro (la media de sus filas). Tu fila va al grupo con el centro más cercano: el ", h("b", null, String(ex.group)), ".");
    out.append(barList({ items: ex.distances.map((d) => ({ label: `Grupo ${d.group}`, value: d.distance, tip: d.group === ex.group ? "el más cercano" : "" })),
      format: (v) => "distancia " + fmt(v, 2), labelWidth: 90 }));
  }
  return out;
}

/** Cómo se ha preparado una fila: el valor de cada columna y los números en que se convierte. */
export function preparedView(steps) {
  if (!steps || !steps.length) return null;
  return h("div", { class: "table-scroll" }, h("table", { class: "mini-table row-trace" },
    h("thead", null, h("tr", null, h("th", null, "Columna"), h("th", null, "Valor"), h("th", null, "Números"), h("th", null, "Escalados"))),
    h("tbody", null, steps.map((s) => h("tr", null,
      h("td", null, h("b", null, s.column)),
      h("td", null, s.value == null ? h("span", { class: "cell-missing" }, "vacío") : String(s.value)),
      h("td", null, h("div", { class: "feat-line" }, s.features.map((f) => h("span", { title: f.name },
        s.features.length > 1 ? `${f.name.split(" = ").pop()}: ` : "", h("b", null, fmt(f.raw, 3)))))),
      h("td", null, h("div", { class: "feat-line" }, s.features.map((f) => h("span", { title: f.name }, fmt(f.scaled, 2))))))))));
}

/**
 * Lo que ve la red con una imagen (cnn.py → inside()): dónde ha mirado, qué detectores se han encendido y los
 * mapas de cada capa. classes: los nombres de las clases; image: la imagen (data: URL) de entrada.
 */
export function cnnInsideView(inside, classes, image) {
  const cls = classes[inside.class];
  const maps = inside.maps.map((m) => h("div", { class: "maps-row" },
    h("div", { class: "chart-title" }, `Capa ${m.layer}: ${m.images.length} mapas de ${m.size} × ${m.size}`),
    h("div", { class: "maps-grid" }, m.images.slice(0, 16).map((src, i) => h("img", { src, alt: `mapa ${i + 1} de la capa ${m.layer}`, title: `filtro ${i + 1}` })))));
  const det = inside.detectors.map((d) => ({ label: `detector ${d.index}`, value: d.contribution,
    tip: `se ha encendido ${fmt(d.value, 2)} × su peso para ${q(cls)}` }));
  return h("div", { class: "col", style: { gap: "16px" } },
    h("div", { class: "see-inside" },
      h("div", { class: "see-pair" },
        h("figure", null, pixelImage(image, { size: 128, label: "Tu imagen" }), h("figcaption", null, "La imagen")),
        h("figure", null, saliencyOverlay(image, inside.saliency, { size: 128 }), h("figcaption", null, "Dónde ha mirado"))),
      h("div", { class: "col", style: { gap: "8px" } },
        h("p", { style: { margin: 0 } }, "En naranja, los píxeles que más han pesado para decir ", h("b", null, q(cls)),
          ": si cambiaran un poco, su puntuación cambiaría mucho (se calcula con el gradiente, como al entrenar)."),
        h("div", { class: "sal-key" }, "poco", h("span", { class: "sal-ramp" }), "mucho"))),
    h("div", null, h("div", { class: "chart-title" }, `Los detectores (filtros de la última capa) que más han pesado para ${q(cls)}`),
      divergingBars({ items: det, legend: [`empuja hacia ${q(cls)}`, "le resta"], format: (v) => (v > 0 ? "+" : "") + nf(2).format(v), labelWidth: 110 })),
    h("div", { class: "col", style: { gap: "12px" } }, h("div", { class: "muted small" },
      "Lo que ve cada capa: cada mapa es la imagen pasada por un filtro (claro = el filtro ha encontrado su dibujo). Las primeras capas ven bordes y colores; las últimas, trozos de forma."),
    maps));
}
