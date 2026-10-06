// Un entrenamiento: cómo va en directo (pasos, registro, avance) y, al terminar, la tabla de los algoritmos
// probados con su nota (lo que Azure llama «modelos» de un trabajo de ML automatizado).
import { ml } from "../api.js";
import { h, icon, clear, toast, errorToast, pageHead, fullDate, timeAgo, busy } from "../ui.js";
import { nf } from "../charts.js";
import { multiLine } from "../ml-charts.js";
import { projectPath, reloadProject, state } from "../app.js";
import { statusBadge, isLive, fmtMetric, metricName, higherIsBetter, isPct, fmtDuration, keepTogether, TASKS } from "../ml-common.js";

// los pasos que se esperan según la tarea (los títulos los pone el servidor al llegar a cada uno)
const PLAN = {
  supervised: [["data", "Leer los datos"], ["split", "Separar entrenamiento y examen"], ["prep", "Preparar los datos"],
    ["try", "Probar los algoritmos"], ["choose", "Elegir el mejor"], ["explain", "Explicar los modelos"]],
  clustering: [["data", "Leer los datos"], ["prep", "Preparar los datos"], ["try", "Buscar grupos (k-medias)"], ["explain", "Describir los grupos"]],
  images: [["data", "Leer las imágenes"], ["split", "Separar entrenamiento y examen"], ["try", "Probar los algoritmos"],
    ["choose", "Elegir el mejor"], ["explain", "Explicar los modelos"]],
};
const STEP_HELP = {
  data: "Las filas que se usan: las que tienen valor en la columna que se predice.",
  split: "Una parte se esconde para el examen final: el modelo no la verá hasta el final.",
  prep: "Rellenar vacíos, pasar las categorías a 0 y 1 y escalar los números (lo aprende solo con el entrenamiento).",
  try: "Cada algoritmo aprende con el entrenamiento y se examina.",
  choose: "Gana el de mejor nota en la validación cruzada (o en el examen, si no hay).",
  explain: "Métricas, gráficos e importancia de cada columna de cada modelo.",
};

// curvas de la red neuronal a partir del registro: «Red convolucional (color): vuelta 3: error 0,812, acierta el 61 % … y el 58 % del examen»
const EPOCH_RE = /^(.*?): vuelta (\d+): error ([\d.,]+), acierta el (\d+) %[^\d]*(?:y el (\d+) % del examen)?/;
function epochCurves(log) {
  const by = new Map();
  for (const l of log) {
    const m = EPOCH_RE.exec(l.text);
    if (!m) continue;
    if (!by.has(m[1])) by.set(m[1], []);
    by.get(m[1]).push({ epoch: +m[2], loss: +m[3].replace(",", "."), train: +m[4] / 100, test: m[5] != null ? +m[5] / 100 : null });
  }
  return by;
}

export async function render(el, params) {
  const p = state.project;
  const jid = params[1];
  const page = h("div", { class: "page cq" });
  el.append(page);
  let job;
  try {
    job = await ml.job(p.id, jid);
  } catch (e) {
    page.append(h("div", { class: "notice danger" }, icon("alert"), e.message));
    return null;
  }
  const badgeBox = h("span");
  const cancelBtn = h("button", { class: "btn danger", type: "button", onclick: () => busy(cancelBtn, async () => {
    try { await ml.cancel(p.id, jid); toast("Cancelando…", "info"); } catch (e) { errorToast(e); }
  }) }, icon("stop"), "Cancelar");
  const actions = h("div", { class: "row wrap" });
  page.append(pageHead({
    icon: "flask", title: job.name,
    crumbs: [{ label: "Entrenar", href: projectPath("train") }, { label: "Entrenamiento" }],
    sub: h("span", { class: "row wrap", style: { gap: "8px" } }, badgeBox, h("span", { title: fullDate(job.createdAt) }, "Empezó " + timeAgo(job.createdAt))),
    actions: [actions],
  }));

  // avance
  const pct = h("span", { class: "pct" }, "0 %");
  const elapsed = h("span");
  const bar = h("div", { class: "job-progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-label": "Avance" }, h("span", { style: { width: "0%" } }));
  const progressCard = h("div", { class: "card", style: { marginBottom: "16px" } }, h("div", { class: "card-body col", style: { gap: "10px", paddingTop: "16px" } },
    h("div", { class: "job-top" }, pct, h("span", { class: "grow" }, elapsed)), bar));
  const steps = h("ol", { class: "steps" });
  const log = h("div", { class: "job-log", "aria-live": "polite" });
  const curveBox = h("div");
  const live = h("div", { class: "job-grid" },
    h("div", { class: "card" }, h("div", { class: "card-head" }, icon("list"), h("h2", null, "Pasos")), h("div", { class: "card-body" }, steps)),
    h("div", { class: "col", style: { gap: "16px", minWidth: "0" } },
      h("div", { class: "card", style: { margin: 0 } }, h("div", { class: "card-head" }, icon("terminal"), h("h2", null, "Registro"),
        h("span", { class: "help" }, "Lo que va haciendo, paso a paso")), h("div", { class: "card-body" }, log)),
      curveBox));
  const result = h("div");
  page.append(progressCard, result, live);

  const plan = PLAN[job.task === "clustering" ? "clustering" : job.task === "images" ? "images" : "supervised"];
  let logCount = 0, timer = 0, stopped = false, lastStatus = null;

  function paint(j) {
    clear(badgeBox).append(statusBadge(j.status));
    const frac = j.status === "done" ? 1 : j.fraction || 0;
    pct.textContent = nf(0).format(frac * 100) + " %";
    bar.firstChild.style.width = (frac * 100).toFixed(1) + "%";
    bar.setAttribute("aria-valuenow", String(Math.round(frac * 100)));
    bar.className = "job-progress " + (isLive(j.status) ? "running" : j.status === "done" ? "done" : j.status === "failed" ? "failed" : "");
    const secs = j.status === "running" ? j.elapsed : j.finishedAt && j.startedAt ? j.finishedAt - j.startedAt : null;
    elapsed.textContent = j.status === "queued" ? "En cola: empieza en cuanto haya sitio en el servidor."
      : j.status === "running" ? `Entrenando · ${fmtDuration(secs)}` : secs != null ? `Tardó ${fmtDuration(secs)}` : "";
    // pasos: los del plan, con lo que ha contado el servidor de cada uno
    const got = new Map((j.steps || []).map((s) => [s.key, s]));
    clear(steps);
    plan.forEach(([key, title], i) => {
      const s = got.get(key);
      const status = s ? (s.status === "running" && isLive(j.status) ? "active" : "done") : "pending";
      steps.append(h("li", { class: "step " + status + (i === plan.length - 1 ? " final" : "") },
        h("span", { class: "step-num" }, status === "done" ? "✓" : String(i + 1)),
        h("div", { class: "step-body" },
          h("div", { class: "step-title" }, s ? s.title : title, s && s.t != null ? h("span", { class: "step-time" }, `${nf(1).format(s.t)} s`) : null),
          h("div", { class: "step-detail" }, s && s.detail ? s.detail : STEP_HELP[key]))));
    });
    // registro: solo las líneas nuevas
    const lines = j.log || [];
    if (lines.length < logCount) { clear(log); logCount = 0; }
    const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
    for (const l of lines.slice(logCount)) {
      log.append(h("div", null, h("span", { class: "t" }, nf(1).format(l.t) + " s"), h("span", { class: "msg" }, l.text)));
    }
    logCount = lines.length;
    if (atBottom) log.scrollTop = log.scrollHeight;
    paintCurves(lines);
    // acciones
    clear(actions);
    if (isLive(j.status)) actions.append(cancelBtn);
    else {
      actions.append(h("a", { class: "btn", href: projectPath("train") }, icon("refresh"), "Entrenar otra vez"));
      if (j.status === "done" && j.best) actions.append(h("a", { class: "btn primary", href: projectPath("models/" + j.best.modelId) }, "Ver el mejor modelo", icon("arrowRight")));
    }
    if (j.status !== lastStatus) {
      lastStatus = j.status;
      paintResult(j);
    }
  }

  function paintCurves(lines) {
    const curves = epochCurves(lines);
    if (!curves.size) { clear(curveBox); return; }
    const [name, pts] = [...curves.entries()].pop();
    if (pts.length < 2) return;
    const series = [{ name: "entrenamiento", data: pts.map((q) => ({ x: q.epoch, y: q.train })) }];
    if (pts.some((q) => q.test != null)) series.push({ name: "examen", data: pts.filter((q) => q.test != null).map((q) => ({ x: q.epoch, y: q.test })) });
    clear(curveBox).append(h("div", { class: "card", style: { margin: 0 } },
      h("div", { class: "card-head" }, icon("pulse"), h("h2", null, "Aprendiendo: " + name)),
      h("div", { class: "card-body" }, h("p", { class: "muted small", style: { margin: "0 0 8px" } },
        "Qué parte acierta después de cada vuelta. Si la de entrenamiento sube y la del examen se queda atrás, está empezando a aprender de memoria."),
      multiLine({ series, yMax: 1, yFormat: (v) => nf(0).format(v * 100) + " %", xLabel: "vuelta", label: "Aciertos por vuelta" }))));
  }

  function paintResult(j) {
    clear(result);
    if (j.status === "failed" || j.status === "interrupted") {
      result.append(h("div", { class: "notice danger", style: { marginBottom: "16px" } }, icon("alert"),
        h("div", null, h("b", null, j.status === "failed" ? "No se ha podido entrenar. " : "Se ha interrumpido. "), j.error || "")));
    } else if (j.status === "cancelled") {
      result.append(h("div", { class: "notice", style: { marginBottom: "16px" } }, icon("info"), "Has cancelado este entrenamiento: no se ha guardado ningún modelo."));
    } else if (j.status === "done" && j.leaderboard) {
      result.append(leaderboard(p, j));
    }
  }

  async function poll() {
    if (stopped) return;
    try {
      const j = await ml.job(p.id, jid);
      if (stopped) return;
      paint(j);
      if (isLive(j.status)) {
        timer = setTimeout(poll, 600);
      } else {
        reloadProject().catch(() => {});
        if (j.status === "done") toast("Entrenamiento terminado", "success");
      }
    } catch (e) {
      if (!stopped) timer = setTimeout(poll, 2000);
    }
  }
  paint(job);
  if (isLive(job.status)) timer = setTimeout(poll, 500);
  return { destroy: () => { stopped = true; clearTimeout(timer); } };
}

// ------------------------------------------------------------ resultados
function leaderboard(p, j) {
  const metric = j.metric;
  const hib = higherIsBetter(metric);
  const board = j.leaderboard;
  const cvShown = board.some((r) => r.cv);
  const clustering = j.task === "clustering";
  const scoreOf = (r) => (r.cv ? r.cv.mean : r.test);
  const vals = board.map(scoreOf).filter((v) => v != null && isFinite(v));
  const top = Math.max(...vals.map((v) => Math.abs(v)), 1e-9);
  const best = board.find((r) => r.best);
  const base = board.find((r) => r.baseline);
  const fill = (v) => {
    if (v == null || !isFinite(v)) return 0;
    if (isPct(metric) || metric === "silhouette" || metric === "r2") return Math.max(0, Math.min(1, v));
    return hib ? v / top : Math.max(0.03, 1 - v / (top * 1.05));  // errores: la barra más larga, el que menos se equivoca
  };
  const overfit = (r) => r.train != null && (isPct(metric) || metric === "r2") && r.train - r.test > 0.12;
  const rows = board.map((r) => {
    const link = r.modelId ? h("a", { href: projectPath("models/" + r.modelId) }, keepTogether(r.name)) : h("span", null, keepTogether(r.name));
    const score = scoreOf(r);
    return h("tr", { class: (r.best ? "best" : "") + (r.baseline ? " baseline" : "") },
      h("td", null, h("div", { class: "lb-name" }, link,
        r.best ? h("span", { class: "badge chosen" }, icon("check"), "Elegido") : null,
        r.baseline ? h("span", { class: "badge", title: "Siempre dice lo más frecuente: los demás tienen que ganarle" }, "referencia") : null,
        overfit(r) ? h("span", { class: "badge overfit", title: `En entrenamiento saca ${fmtMetric(metric, r.train)}: se ha aprendido parte de las filas de memoria (sobreajuste)` }, "memoriza") : null)),
      h("td", { class: "num" }, h("div", { class: "lb-score" },
        h("span", null, h("b", null, fmtMetric(metric, score)), r.cv ? h("div", { class: "pm" }, "±\u00a0" + fmtMetric(metric, r.cv.std).replace(/\s%$/, "")) : null),
        h("div", { class: "lb-track" }, h("div", { class: "lb-fill", style: { width: (fill(score) * 100).toFixed(1) + "%" } })))),
      cvShown ? h("td", { class: "num" }, fmtMetric(metric, r.test)) : null,
      clustering ? null : h("td", { class: "num muted" }, fmtMetric(metric, r.train)),
      h("td", { class: "num muted" }, r.ms == null ? "—" : r.ms < 1000 ? nf(0).format(r.ms) + " ms" : fmtDuration(r.ms / 1000)));
  });
  const table = h("table", { class: "table" },
    h("thead", null, h("tr", null,
      h("th", { scope: "col" }, clustering ? "Grupos probados" : "Algoritmo"),
      h("th", { scope: "col", class: "num", title: cvShown ? "Media de las rondas de validación cruzada (lo que se usa para elegir)" : "Nota en el examen final" },
        cvShown ? `${metricName(metric)} (validación)` : metricName(metric)),
      cvShown ? h("th", { scope: "col", class: "num", title: "Con las filas escondidas, al final" }, "Examen") : null,
      clustering ? null : h("th", { scope: "col", class: "num", title: "Con las mismas filas con las que aprendió" }, "Entrenamiento"),
      h("th", { scope: "col", class: "num" }, "Tiempo"))),
    h("tbody", null, rows));
  const lines = [];
  if (best && !clustering) {
    lines.push(h("p", { style: { margin: 0 } }, "El mejor ha sido ", h("b", null, best.name), ": ",
      `${metricName(metric).toLowerCase()} de ${fmtMetric(metric, scoreOf(best))}`, cvShown ? " en la validación cruzada y " : " y ",
      `${fmtMetric(metric, best.test)} en el examen final`,
      base ? [" (adivinando sale ", fmtMetric(metric, scoreOf(base)), ")."] : "."));
  } else if (best && clustering) {
    lines.push(h("p", { style: { margin: 0 } }, "Con ", h("b", null, best.name.replace(/^k-medias \(k = (\d+)\)$/, "$1 grupos")),
      ` los grupos quedan más separados (silueta ${fmtMetric(metric, best.test)}).`));
  }
  if (!hib) lines.push(h("p", { class: "muted small", style: { margin: 0 } }, `En ${metricName(metric)} cuanto más bajo, mejor (es lo que se equivoca).`));
  return h("div", { class: "card leaderboard", style: { marginBottom: "16px" } },
    h("div", { class: "card-head" }, icon("chart"), h("h2", null, clustering ? "Números de grupos probados" : "Algoritmos probados"),
      h("span", { class: "help" }, `${TASKS[j.task] ? TASKS[j.task].label : ""} · ${nf(0).format(j.rows ? j.rows.train : 0)} filas de entrenamiento, ${nf(0).format(j.rows ? j.rows.test : 0)} de examen`)),
    h("div", { class: "card-body col", style: { gap: "10px", paddingBottom: "6px" } }, lines),
    h("div", { class: "table-wrap", style: { border: 0, borderTop: "1px solid var(--border)", borderRadius: "0 0 var(--radius) var(--radius)" } }, table));
}
