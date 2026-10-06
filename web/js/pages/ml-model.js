// Un modelo: cómo de bien funciona (Resultados), qué ha aprendido por dentro, cómo se prepararon los datos y
// el script equivalente en Python (para verlo como código o llevarlo a Azure ML).
import { ml } from "../api.js";
import { h, icon, clear, toast, errorToast, confirmDialog, pageHead, segmented, codeBlock, downloadFile, countUp, busy, timeAgo,
  fullDate } from "../ui.js";
import { barList, divergingBars, heatmap, columnChart, nf, HEAT_WORDS_ML } from "../charts.js";
import { xyScatter, multiLine, groupScatter, treeDiagram, treeOutline, rocChart, pixelImage, fmt } from "../ml-charts.js";
import { navigate, projectPath, reloadProject, state } from "../app.js";
import { fmtMetric, fmtNum, metricName, METRIC_HELP, isPct, verdict, TASKS, fmtDuration } from "../ml-common.js";
import { cnnInsideView } from "../ml-views.js";

const TAB_KEY = "ml.model.tab";
const pct = (v) => nf(1).format(v * 100) + " %";

export async function render(el, params, query) {
  const p = state.project;
  const mid = params[1];
  const page = h("div", { class: "page cq" });
  el.append(page);
  let m;
  try {
    m = await ml.model(p.id, mid);
  } catch (e) {
    page.append(h("div", { class: "notice danger" }, icon("alert"), e.message, " ", h("a", { href: projectPath("models") }, "Ver los modelos")));
    return null;
  }
  const r = m.report;
  const published = p.published && p.published.modelId === mid;
  const publishBtn = h("button", { class: "btn" + (published ? "" : " primary"), type: "button",
    title: published ? "Dejar de publicarlo" : "Que responda en la dirección de la API del proyecto",
    onclick: () => busy(publishBtn, async () => {
      try {
        await ml.publish(p.id, published ? null : mid);
        await reloadProject();
        toast(published ? "Ya no está publicado" : "Publicado: ya responde en la API del proyecto", "success");
        navigate(projectPath("models/" + mid));
      } catch (e) { errorToast(e); }
    }) }, icon("globe"), published ? "Despublicar" : "Publicar");
  const del = h("button", { class: "btn ghost icon-only", type: "button", "aria-label": "Borrar el modelo", title: "Borrar el modelo",
    onclick: async () => {
      if (!(await confirmDialog(`Se borrará el modelo «${r.name}».`, { title: "Borrar el modelo", okLabel: "Borrar", danger: true }))) return;
      try { await ml.deleteModel(p.id, mid); await reloadProject(); toast("Modelo borrado", "success"); navigate(projectPath("models")); } catch (e) { errorToast(e); }
    } }, icon("trash"));
  const task = TASKS[r.task] || { label: r.task };
  page.append(pageHead({
    icon: "chart", title: r.name,
    crumbs: [{ label: "Modelos", href: projectPath("models") }, { label: task.label + (r.target && r.task !== "images" ? ` «${r.target}»` : "") }],
    sub: h("span", null, r.paramsText ? `Ajustes: ${r.paramsText}` : "Sin ajustes",
      h("span", { class: "faint", title: fullDate(m.createdAt) }, ` · entrenado ${timeAgo(m.createdAt)}`)),
    actions: [
      published ? h("span", { class: "badge live" }, "Publicado") : null,
      r.best ? h("span", { class: "badge primary" }, icon("sparkle"), "El mejor de su entrenamiento") : null,
      h("a", { class: "btn", href: projectPath("predict") + "?model=" + encodeURIComponent(mid) }, icon("target"), "Probar"),
      publishBtn, del],
  }));

  const tabs = [{ key: "results", label: "Resultados" }, { key: "learned", label: "Lo que ha aprendido" }];
  if (r.task !== "images") tabs.push({ key: "prep", label: "Preparar los datos" });
  tabs.push({ key: "code", label: "Código" });
  let current = (query && query.get("tab")) || sessionGet(TAB_KEY) || "results";
  if (!tabs.some((t) => t.key === current)) current = "results";
  const body = h("div");
  const show = (key) => {
    current = key;
    sessionSet(TAB_KEY, key);
    clear(body);
    const view = key === "results" ? results(p, m) : key === "learned" ? learned(p, m) : key === "prep" ? prepView(m) : codeView(p, m);
    body.append(view);
  };
  page.append(h("div", { class: "model-tabs" }, segmented({ items: tabs, active: current, label: "Partes del modelo", onChange: show })), body);
  show(current);
  return null;
}

function sessionGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
function sessionSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } }

function card(title, ic, ...content) {
  return h("div", { class: "card" }, h("div", { class: "card-head" }, icon(ic), h("h2", null, title)), h("div", { class: "card-body col", style: { gap: "12px" } }, ...content));
}
const help = (...c) => h("p", { class: "muted small", style: { margin: 0 } }, ...c);

// ------------------------------------------------------------ resultados
function results(p, m) {
  const r = m.report;
  const out = h("div", { class: "col", style: { gap: "16px" } });
  const metric = r.metric;
  const main = r.metrics[metric];
  const bigEl = h("span", { class: "big" });
  countUp(bigEl, main, (v) => fmtMetric(metric, v));
  const stats = [];
  if (r.cv) stats.push(statBox(fmtMetric(metric, r.cv.mean), `en la validación cruzada (± ${fmtMetric(metric, r.cv.std).replace(" %", "")}, ${r.cv.scores.length} rondas)`));
  if (r.trainMetrics && r.trainMetrics[metric] != null) stats.push(statBox(fmtMetric(metric, r.trainMetrics[metric]), "con las filas con las que aprendió"));
  if (r.rows) stats.push(statBox(nf(0).format(r.rows.train), r.task === "clustering" ? "filas agrupadas" : "filas para aprender"));
  if (r.rows && r.rows.test) stats.push(statBox(nf(0).format(r.rows.test), "filas de examen"));
  if (r.ms != null) stats.push(statBox(fmtDuration(r.ms / 1000), "en entrenar"));
  const gap = r.trainMetrics && (isPct(metric) || metric === "r2") ? r.trainMetrics[metric] - main : 0;
  out.append(h("div", { class: "card" }, h("div", { class: "card-body col", style: { gap: "14px", paddingTop: "18px" } },
    h("div", { class: "metric-hero" },
      h("div", null, h("div", { class: "chart-title" }, metricName(metric) + (r.task === "clustering" ? "" : " en el examen final")), bigEl),
      h("div", { class: "col", style: { gap: "6px" } }, verdict(metric, main, null), h("div", { class: "what" }, METRIC_HELP[metric]))),
    h("div", { class: "grid-stats", style: { margin: 0, gridTemplateColumns: `repeat(${Math.min(5, stats.length || 1)}, minmax(0, 1fr))` } }, stats),
    gap > 0.12 ? h("div", { class: "notice warning" }, icon("alert"), h("div", null, h("b", null, "Aprende de memoria (sobreajuste). "),
      `Con sus propias filas saca ${fmtMetric(metric, r.trainMetrics[metric])}, pero con filas nuevas, ${fmtMetric(metric, main)}. `,
      "Prueba a hacerlo más sencillo (menos profundidad, más vecinos, más regularización) o a darle más datos.")) : null)));

  if (r.task === "classification" || r.task === "images") {
    const conf = r.charts.confusion;
    const per = r.metrics.perClass || [];
    out.append(h("div", { class: "result-grid" },
      card("Matriz de confusión", "table", help("Cada fila es la clase de verdad y cada columna, lo que dijo el modelo. La diagonal son los aciertos; lo demás, con qué se confunde."),
        heatmap({ labels: conf.labels, counts: conf.counts,
          words: r.task === "images" ? { ...HEAT_WORDS_ML, one: "imagen", many: "imágenes" } : HEAT_WORDS_ML })),
      card("Cada clase", "list", help("Precisión: cuando dice esa clase, ¿acierta? Exhaustividad: de las que lo son, ¿cuántas encuentra?"),
        h("div", { class: "table-wrap per-class" }, h("table", { class: "table" },
          h("thead", null, h("tr", null, h("th", null, "Clase"), h("th", { class: "num" }, "Precisión"), h("th", { class: "num" }, "Exhaustividad"),
            h("th", { class: "num" }, "F1"), h("th", { class: "num" }, "Filas"))),
          h("tbody", null, per.map((c, i) => h("tr", null, h("td", null, h("b", null, conf.labels[i])), h("td", { class: "num" }, pct(c.precision)),
            h("td", { class: "num" }, pct(c.recall)), h("td", { class: "num" }, pct(c.f1)), h("td", { class: "num muted" }, String(c.support))))))))));
    if (r.charts.roc && r.charts.roc.points && r.charts.roc.points.length) {
      out.append(card("Curva ROC", "pulse", help(`Para cada umbral de probabilidad, qué parte de los «${conf.labels[1]}» encuentra (aciertos) y cuántos «${conf.labels[0]}» confunde (falsas alarmas). Cuanto más pegada arriba a la izquierda, mejor; el área (AUC) va de 0,5 (al azar) a 1 (perfecto).`),
        rocChart({ points: r.charts.roc.points, auc: r.charts.roc.auc, positive: conf.labels[1] })));
    }
    if (r.charts.mistakes) {
      const mk = r.charts.mistakes;
      out.append(card("Sus fallos en el examen", "alert", mk.length
        ? [help("Las imágenes del examen en las que se ha equivocado: a veces se ve por qué (una foto rara, un fondo que despista)."),
          h("div", { class: "mistakes" }, mk.map((x, i) => h("div", { class: "mistake", style: { "--i": i } }, pixelImage(x.thumb, { size: 96, label: x.real }),
            h("span", { class: "real" }, "Era ", h("b", null, x.real)), h("span", { class: "pred" }, `Dijo «${x.predicted}» (${nf(0).format(x.confidence * 100)} %)`))))]
        : help("¡Ninguno! Ha acertado todas las imágenes del examen.")));
    }
  } else if (r.task === "regression") {
    const sc = r.charts.scatter || [];
    out.append(h("div", { class: "result-grid" },
      card("Lo real frente a lo predicho", "target", help("Cada punto es una fila del examen. Si acertara siempre, todos estarían sobre la línea discontinua."),
        xyScatter({ points: sc.map((d) => ({ x: d.x, y: d.y, title: `Predijo ${fmtNum(d.y)}`, tip: `era ${fmtNum(d.x)} · fila ${d.row + 1}` })),
          xLabel: `${r.target} real`, yLabel: `${r.target} predicho`, diagonal: true, width: 460, height: 340 })),
      card("Lo que se equivoca", "chart", help("Cuántas filas del examen tienen cada error (predicho − real). Lo ideal: una montaña estrecha centrada en 0."),
        r.charts.residuals ? residualsChart(r.charts.residuals) : null,
        h("div", { class: "kv-table small" },
          h("div", null, "R²"), h("div", null, h("b", null, fmt(r.metrics.r2, 3))),
          h("div", null, "Error medio (MAE)"), h("div", null, h("b", null, fmtNum(r.metrics.mae)), h("span", { class: "muted" }, ` (la media de «${r.target}» es ${fmtNum(r.metrics.meanTarget)})`)),
          h("div", null, "RMSE"), h("div", null, h("b", null, fmtNum(r.metrics.rmse))),
          h("div", null, "El mayor error"), h("div", null, h("b", null, fmtNum(r.metrics.maxError)))))));
  } else if (r.task === "clustering") {
    out.append(clusteringResults(r));
  }
  if (r.charts.importance && r.charts.importance.length) {
    const imp = r.charts.importance;
    out.append(card("Qué columnas usa más", "layers",
      help("Importancia por permutación: se barajan los valores de una columna (rompiendo su relación con la respuesta) y se mide cuánto empeora. Si casi no empeora, el modelo no la usa."),
      barList({ items: imp.map((i) => ({ label: i.column, value: Math.max(0, i.value), tip: `empeora ${fmtMetric(r.metric, i.value)} si se baraja` })),
        format: (v) => (isPct(r.metric) ? "−" + nf(1).format(v * 100) + " puntos" : "−" + fmt(v, 3)), labelWidth: 160 })));
  }
  return out;
}

function statBox(value, label) {
  return h("div", { class: "card stat", style: { margin: 0, padding: "12px 14px" } }, h("div", { class: "v", style: { fontSize: "20px" } }, value), h("div", { class: "l", style: { paddingRight: 0 } }, label));
}

function residualsChart(res) {
  const data = res.counts.map((c, i) => ({ x: fmtNum((res.edges[i] + res.edges[i + 1]) / 2), value: c, title: `${c} filas`,
    tip: `error de ${fmtNum(res.edges[i])} a ${fmtNum(res.edges[i + 1])}` }));
  return columnChart({ data, label: "Errores del examen", every: 3, width: 440, height: 170 });
}

function clusteringResults(r) {
  const ch = r.charts;
  const k = r.metrics.k;
  const profiles = r.profiles || [];
  const out = h("div", { class: "col", style: { gap: "16px" } });
  const profBox = h("div", { class: "group-profiles" });
  const paintProfiles = (active) => {
    clear(profBox).append(...profiles.map((g) => {
      const rows = g.columns.slice(0, 6).map((c) => c.kind === "number"
        ? h("div", { class: "gc-row" }, h("span", { title: c.column }, c.column), h("b", { class: c.mean > c.overall ? "up" : null,
          title: `media de todas las filas: ${fmtNum(c.overall)}` }, fmtNum(c.mean), h("span", { class: "faint" }, c.mean > c.overall * 1.05 ? " ↑" : c.mean < c.overall * 0.95 ? " ↓" : "")))
        : h("div", { class: "gc-row" }, h("span", { title: c.column }, c.column), h("b", null, `${c.top} (${nf(0).format(c.share * 100)} %)`)));
      return h("div", { class: "group-card" + (g.group === active ? " on" : "") }, h("h4", null, `Grupo ${g.group}`, h("span", { class: "badge" }, `${g.size} filas`)), rows);
    }));
  };
  const plot = groupScatter({ points: ch.points, centers: ch.centers, k, onPick: (g) => paintProfiles(g) });
  const varText = ch.variance ? `Las dos direcciones del dibujo recogen el ${nf(0).format((ch.variance[0] + ch.variance[1]) * 100)} % de lo que varían los datos` : "";
  out.append(card("Los grupos en un plano", "dots",
    help("Los datos tienen muchas columnas; para dibujarlos se proyectan en las dos direcciones en las que más varían (análisis de componentes principales). ",
      varText, ". Los círculos con número son los centros.", k > 3 ? " Pulsa un grupo en la leyenda para resaltarlo." : ""),
    plot));
  paintProfiles(k > 3 ? 1 : null);
  out.append(card("Cómo es cada grupo", "list", help("La media de cada columna en el grupo (↑ más alta y ↓ más baja que en el total) o su valor más frecuente."), profBox));
  if (ch.search && ch.search.length > 1) {
    out.append(h("div", { class: "result-grid" },
      card("Silueta según el número de grupos", "pulse", help("Se elige el número de grupos con la silueta más alta: los grupos más separados entre sí."),
        multiLine({ series: [{ name: "silueta", data: ch.search.map((s) => ({ x: s.k, y: s.silhouette })) }], yMin: Math.min(0, ...ch.search.map((s) => s.silhouette)),
          yMax: Math.max(...ch.search.map((s) => s.silhouette)) * 1.1, yFormat: (v) => fmt(v, 2), xLabel: "grupos", label: "Silueta por número de grupos" })),
      card("Inercia (el «codo»)", "chart", help("La suma de las distancias de cada fila a su centro. Siempre baja con más grupos; donde deja de bajar mucho (el codo) suele estar un buen número."),
        multiLine({ series: [{ name: "inercia", data: ch.search.map((s) => ({ x: s.k, y: s.inertia })) }], yFormat: (v) => fmtNum(v), xLabel: "grupos", label: "Inercia por número de grupos" }))));
  }
  if (ch.compare) {
    const c = ch.compare;
    out.append(card(`Los grupos frente a «${c.column}»`, "table",
      help(`Cuántas filas de cada valor de «${c.column}» han caído en cada grupo (sin que el modelo la viera). Cada grupo coincide con una sola clase en el `,
        h("b", null, nf(0).format(c.purity * 100) + " %"), " de las filas."),
      h("div", { class: "table-wrap" }, h("table", { class: "table" },
        h("thead", null, h("tr", null, h("th", null, "Grupo"), c.classes.map((x) => h("th", { class: "num" }, x)))),
        h("tbody", null, c.counts.map((row, g) => {
          const max = Math.max(...row);
          return h("tr", null, h("td", null, h("b", null, `Grupo ${g + 1}`)), row.map((v) => h("td", { class: "num", style: v === max && v ? { fontWeight: 700 } : { color: "var(--muted)" } }, String(v))));
        }))))));
  }
  return out;
}

// --------------------------------------------------- lo que ha aprendido
function learned(p, m) {
  const r = m.report;
  const L = r.learned || {};
  const out = h("div", { class: "col", style: { gap: "16px" } });
  out.append(h("div", { class: "notice info" }, icon("info"), h("div", null, h("b", null, r.name + ": "), r.summary, " ",
    h("a", { href: projectPath("inside") + "?sec=" + encodeURIComponent(r.algorithm) }, "Cómo funciona por dentro →"))));
  if (L.kind === "baseline" || L.kind === "knn" || L.kind === "pixels_knn") {
    out.append(card("Lo que guarda", "inbox", h("p", { style: { margin: 0 } }, L.text),
      L.kind !== "baseline" ? help("Para ver con qué vecinos decide, prueba una fila en «Probar»: te enseña los más parecidos.") : null));
  } else if (L.kind === "linear") {
    const coefs = L.coefficients || [];
    out.append(card("La fórmula", "scale",
      h("p", { style: { margin: 0 } }, `${r.target} ≈ `, h("b", null, fmtNum(L.mean)), " (la media) + la suma de cada columna × su peso."),
      help("Los pesos están en «desviaciones típicas»: cuánto sube o baja la predicción si esa columna sube lo que suele variar. Así se pueden comparar entre sí."),
      divergingBars({ items: coefs.slice(0, 16).map((c) => ({ label: c.feature, value: c.weight,
        tip: c.perUnit != null ? `${c.perUnit > 0 ? "+" : ""}${fmtNum(c.perUnit)} por cada unidad` : "si la fila tiene ese valor" })),
      legend: [`sube «${r.target}»`, "lo baja"], format: (v) => (v > 0 ? "+" : "") + fmtNum(v), labelWidth: 170 })));
  } else if (L.kind === "logistic" || L.kind === "pixels_logistic") {
    if (L.history && L.history.length > 1) out.append(learningCurves(L.history, "vuelta"));
    if (L.kind === "logistic") {
      out.append(card("Los pesos de cada clase", "scale",
        help("Cada clase suma las columnas multiplicadas por sus pesos; gana la que más puntúa. Un peso positivo empuja hacia esa clase. Están en «desviaciones típicas» para poder compararlos."),
        h("div", { class: "weights-multiples" }, L.perClass.map((c) => h("div", { class: "multiple" }, h("div", { class: "multiple-title" }, `«${c.class}»`),
          divergingBars({ items: c.weights.map((w) => ({ label: w.feature, value: w.weight })), legend: ["empuja hacia ella", "le resta"],
            format: (v) => (v > 0 ? "+" : "") + nf(2).format(v), labelWidth: 130 }))))));
    } else {
      out.append(card("Lo que mira en cada clase", "image",
        help("Un peso por píxel y clase, dibujado como una imagen: los colores fuertes son los píxeles que más empujan hacia esa clase. No sabe nada de formas: solo de qué píxeles suelen tener qué color."),
        h("div", { class: "templates" }, L.templates.map((t) => h("figure", null, pixelImage(t.image, { size: 96, label: t.class }), h("figcaption", null, t.class))))));
    }
  } else if (L.kind === "tree" || L.kind === "forest") {
    const tree = L.kind === "tree" ? L.tree : L.example;
    const facts = L.kind === "tree"
      ? [`${L.nodes} nodos`, `${L.leaves} hojas (respuestas)`, `${L.depth} preguntas como mucho`]
      : [`${L.trees} árboles`, `${nf(0).format(L.avgNodes)} nodos de media cada uno`];
    let depth = 3, asList = false;
    const view = h("div");
    const depthVal = h("span", { class: "range-value" });
    const paint = () => {
      depthVal.textContent = `${depth} niveles`;
      clear(view).append(asList ? treeOutline({ tree, task: r.task }) : treeDiagram({ tree, task: r.task, depth, n: tree.n }));
    };
    const controls = h("div", { class: "row wrap", style: { gap: "10px" } },
      segmented({ items: [{ key: "tree", label: "Dibujo" }, { key: "list", label: "Lista" }], active: "tree", label: "Cómo verlo",
        onChange: (k) => { asList = k === "list"; depthRow.hidden = asList; paint(); } }));
    const depthRow = h("div", { class: "row", style: { gap: "6px" } },
      h("button", { class: "btn sm icon-only", type: "button", "aria-label": "Menos niveles", onclick: () => { depth = Math.max(1, depth - 1); paint(); } }, "−"),
      depthVal,
      h("button", { class: "btn sm icon-only", type: "button", "aria-label": "Más niveles", onclick: () => { depth = Math.min(6, depth + 1); paint(); } }, icon("plus")));
    controls.append(depthRow);
    paint();
    out.append(card(L.kind === "tree" ? "El árbol" : "Uno de sus árboles", "tree",
      h("div", { class: "data-facts" }, facts.map((f) => h("span", null, f))),
      help(L.kind === "tree"
        ? "Cada caja es una pregunta sobre una columna; según la respuesta, la fila va a la izquierda o a la derecha hasta una hoja, que da la respuesta. La barra es lo segura que está esa caja (la clase que más hay en ella)."
        : "El bosque son muchos árboles como este, cada uno aprendido con una muestra distinta de filas y de columnas. Por separado se equivocan; votando juntos, mucho menos."),
      controls, view));
    if (L.importance && L.importance.length) {
      out.append(card("Cuánto aprende de cada columna", "layers",
        help("Cuánto ordenan las preguntas de cada columna (cuánto reducen la mezcla de clases o el error), sumando todas sus preguntas."),
        barList({ items: L.importance.map((i) => ({ label: i.column, value: i.value })), max: 1, format: (v) => nf(1).format(v * 100) + " %", labelWidth: 160 })));
    }
  } else if (L.kind === "bayes") {
    out.append(card("Lo frecuente que es cada clase (a priori)", "pulse",
      help("Antes de mirar ninguna columna, lo probable que es cada clase: la parte de las filas de entrenamiento que la tienen."),
      barList({ items: L.classes.map((c, i) => ({ label: c, value: L.prior[i] })), max: 1, format: (v) => pct(v), labelWidth: 130 })));
    if (L.numeric.length) {
      out.append(card("Las columnas de números: media ± desviación en cada clase", "hash",
        help("Para cada clase supone una campana de Gauss con esta media y esta desviación. Un valor cerca de la media de una clase la hace más probable."),
        h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("thead", null, h("tr", null, h("th", null, "Columna"), L.classes.map((c) => h("th", { class: "num" }, c)))),
          h("tbody", null, L.numeric.map((n) => h("tr", null, h("td", null, h("b", null, n.column)),
            n.mean.map((mu, i) => h("td", { class: "num" }, fmtNum(mu), h("span", { class: "pm" }, " ± " + fmtNum(n.std[i])))))))))));
    }
    for (const c of L.categorical) {
      out.append(card(`«${c.column}»: lo probable de cada valor en cada clase`, "tag",
        h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("thead", null, h("tr", null, h("th", null, "Valor"), L.classes.map((x) => h("th", { class: "num" }, x)))),
          h("tbody", null, c.values.map((v, j) => h("tr", null, h("td", null, v), c.probs.map((row) => h("td", { class: "num" }, pct(row[j]))))))))));
    }
  } else if (L.kind === "kmeans") {
    out.append(card("Cómo se han colocado los centros", "dots",
      h("div", { class: "data-facts" }, h("span", null, h("b", null, String(L.k)), " grupos"), h("span", null, "silueta ", h("b", null, fmt(L.silhouette, 3))),
        h("span", null, "inercia ", h("b", null, fmtNum(L.inertia)))),
      help("En cada vuelta, cada fila se va con su centro más cercano y cada centro se mueve a la media de su grupo. La inercia (la suma de las distancias al centro) baja hasta que ya no cambia."),
      L.history && L.history.length > 1 ? multiLine({ series: [{ name: "inercia", data: L.history.map((v, i) => ({ x: i + 1, y: v })) }],
        yFormat: (v) => fmtNum(v), xLabel: "vuelta", label: "Inercia en cada vuelta" }) : null));
  } else if (L.kind === "cnn") {
    if (L.history && L.history.length > 1) out.append(learningCurves(L.history, "vuelta"));
    out.append(card("Las capas de la red", "network",
      h("div", { class: "data-facts" }, h("span", null, h("b", null, nf(0).format(L.params)), " números aprendidos (pesos)")),
      h("div", { class: "net-layers" }, L.layers.map((ly, i) => h("div", { class: "net-layer", style: { "--i": i } }, h("span", { class: "nl-num" }, String(i + 1)),
        h("div", null, h("b", null, ly.name), h("div", { class: "nl-text" }, ly.text)),
        h("div", null, h("div", { class: "nl-shape" }, ly.shape), ly.params ? h("div", { class: "nl-params" }, `${nf(0).format(ly.params)} pesos`) : null))))));
    out.append(card("Los filtros de la primera capa", "eye",
      help("Cada cuadradito es un filtro de 3 × 3 que la red ha aprendido sola: busca ese dibujo (un borde en una dirección, un color) por toda la imagen."),
      h("div", { class: "filters-grid" }, L.filters.map((src, i) => h("figure", null, h("img", { src, alt: `filtro ${i + 1}`, style: { "--i": i } }), h("figcaption", null, String(i + 1)))))));
    if (L.example) {
      const ex = L.example;
      const cls = r.classes[ex.class];
      out.append(card("Una imagen del examen, por dentro", "image",
        h("p", { style: { margin: 0 } }, "Era ", h("b", null, `«${ex.real}»`), " y ha dicho ", h("b", null, `«${cls}»`), ` (${nf(0).format(ex.probabilities[ex.class] * 100)} %).`),
        cnnInsideView(ex, r.classes, ex.thumb)));
    }
  } else {
    out.append(help("Este modelo no tiene nada más que enseñar."));
  }
  return out;
}

function learningCurves(history, xLabel) {
  const acc = [{ name: "entrenamiento", data: history.map((d) => ({ x: d.epoch, y: d.accuracy })) }];
  if (history.some((d) => d.testAccuracy != null)) acc.push({ name: "examen", data: history.filter((d) => d.testAccuracy != null).map((d) => ({ x: d.epoch, y: d.testAccuracy })) });
  return h("div", { class: "result-grid" },
    card("El error al aprender", "pulse", help("La pérdida (entropía cruzada): lo lejos que están sus probabilidades de la respuesta correcta. Baja según aprende."),
      multiLine({ series: [{ name: "error", data: history.map((d) => ({ x: d.epoch, y: d.loss })) }], yFormat: (v) => fmt(v, 2), xLabel, label: "Error por vuelta" })),
    card("Lo que acierta", "check", help(acc.length > 1 ? "Si la de entrenamiento sigue subiendo y la del examen no, está aprendiendo de memoria." : "Con las filas de entrenamiento, vuelta a vuelta."),
      multiLine({ series: acc, yMax: 1, yFormat: (v) => nf(0).format(v * 100) + " %", xLabel, label: "Aciertos por vuelta" })));
}

// ------------------------------------------------------ preparar los datos
function prepView(m) {
  const r = m.report;
  const out = h("div", { class: "col", style: { gap: "16px" } });
  const steps = r.prep || [];
  out.append(card("Los pasos", "list",
    help("Los algoritmos solo entienden números. Antes de aprender, cada fila se convierte en una lista de números; lo necesario (medias, categorías…) se aprende solo con las filas de entrenamiento y se guarda con el modelo, para preparar igual las filas nuevas."),
    h("div", { class: "prep-steps" }, steps.map((s, i) => h("div", { class: "prep-step", style: { "--i": i } }, h("span", { class: "sec-num" }, String(i + 1)),
      h("div", null, h("b", null, s.title), h("p", null, s.text), prepItems(s)))))));
  if (r.example && r.example.steps) {
    out.append(card(`Una fila de ejemplo (la ${nf(0).format(r.example.row + 1)} de la tabla)`, "eye",
      help("Cómo queda una fila de verdad: el valor de cada columna, los números en que se convierte y esos números escalados (los que usan los algoritmos que miden distancias o suman pesos; los árboles usan los de antes)."),
      rowTrace(r.example.steps)));
  }
  return out;
}

function prepItems(s) {
  if (!s.items || !s.items.length) return h("div", { class: "muted small" }, s.key === "missing" ? "No había ningún vacío." : "");
  if (s.key === "missing") return h("div", { class: "prep-items" }, s.items.map((i) => h("span", { class: "prep-chip" }, h("b", null, i.column),
    h("span", { class: "faint" }, `${i.missing} ${i.missing === 1 ? "vacío" : "vacíos"} → ${String(i.fill).replace(/^(-?\d+)\.(\d+)$/, "$1,$2")}`))));
  if (s.key === "dates") return h("div", { class: "prep-items" }, s.items.map((i) => h("span", { class: "prep-chip" }, h("b", null, i.column), h("span", { class: "faint" }, "→ " + i.parts.join(", ")))));
  if (s.key === "onehot") return h("div", { class: "col", style: { gap: "8px" } }, s.items.map((i) => h("div", null, h("b", { class: "small" }, i.column),
    h("div", { class: "onehot-demo" }, i.categories.slice(0, 12).map((c) => h("span", null, `${i.column} = ${c}`)), i.categories.length > 12 ? h("span", null, `+${i.categories.length - 12}`) : null))));
  if (s.key === "scale") return h("div", { class: "prep-items" }, s.items.map((i) => h("span", { class: "prep-chip" }, h("b", null, i.column),
    h("span", { class: "faint" }, `media ${fmtNum(i.mean)}, desviación ${fmtNum(i.std)}`))));
  return null;
}

function rowTrace(steps) {
  return h("div", { class: "table-scroll" }, h("table", { class: "mini-table row-trace" },
    h("thead", null, h("tr", null, h("th", null, "Columna"), h("th", null, "Valor"), h("th", null, "Números"), h("th", null, "Escalados"))),
    h("tbody", null, steps.map((s) => h("tr", null,
      h("td", null, h("b", null, s.column)),
      h("td", null, s.value == null ? h("span", { class: "cell-missing" }, "vacío") : String(s.value)),
      h("td", null, h("div", { class: "feat-line" }, s.features.map((f) => h("span", { title: f.name },
        s.features.length > 1 ? h("span", { class: "faint" }, f.name.split(" = ").pop() + ": ") : null, h("b", null, fmt(f.raw, 3)))))),
      h("td", null, h("div", { class: "feat-line" }, s.features.map((f) => h("span", { title: f.name }, fmt(f.scaled, 2))))))))));
}

// ---------------------------------------------------------------- código
function codeView(p, m) {
  const r = m.report;
  const out = h("div", { class: "col", style: { gap: "16px" } });
  const box = h("div", null, h("div", { class: "muted small" }, "Cargando…"));
  const images = r.task === "images";
  const file = `${p.id}-${r.algorithm}.py`;
  let text = "";
  const dl = h("button", { class: "btn", type: "button", disabled: true, onclick: () => downloadFile(file, text, "text/x-python") }, icon("download"), "Descargar " + file);
  const dataBtn = h("button", { class: "btn", type: "button", onclick: async () => {
    try {
      const res = images ? await ml.imagesZip(p.id) : await ml.csv(p.id);
      if (!res.ok) throw new Error("No se ha podido descargar");
      downloadFile(images ? `${p.id}-imagenes.zip` : `${p.id}.csv`, images ? await res.blob() : await res.text(), images ? "application/zip" : "text/csv");
    } catch (e) { errorToast(e); }
  } }, icon("download"), images ? "Descargar las imágenes (ZIP)" : "Descargar los datos (CSV)");
  out.append(h("div", { class: "code-intro" },
    h("div", { class: "share-step" }, h("span", { class: "share-ic" }, icon("code")), h("b", null, "El mismo modelo, en Python"),
      h("p", null, images ? "Con PyTorch (la red) o scikit-learn (los píxeles): las capas y los ajustes de aquí." : "Con scikit-learn y pandas: la misma preparación, el mismo algoritmo y los mismos ajustes.")),
    h("div", { class: "share-step" }, h("span", { class: "share-ic" }, icon("terminal")), h("b", null, "En tu ordenador"),
      h("p", null, "Descarga el script y los datos en la misma carpeta, instala lo que dice arriba del script y ejecútalo con python.")),
    h("div", { class: "share-step" }, h("span", { class: "share-ic" }, icon("globe")), h("b", null, "En Azure ML"),
      h("p", null, "Sube los datos como recurso de datos y crea un trabajo con «Script de entrenamiento personalizado»: este script es el script."))),
  h("div", { class: "row wrap" }, dl, dataBtn), box);
  ml.code(p.id, m.id).then(async (res) => {
    if (!res.ok) throw new Error("No se ha podido generar el script");
    text = await res.text();
    dl.disabled = false;
    clear(box).append(codeBlock(text, { lang: "Python" }));
  }).catch((e) => { clear(box).append(h("div", { class: "notice danger" }, icon("alert"), e.message)); });
  out.append(help("Los resultados saldrán muy parecidos, no idénticos: cada librería tiene sus detalles (el azar, cuándo deja de corregir los pesos…)."));
  return out;
}
