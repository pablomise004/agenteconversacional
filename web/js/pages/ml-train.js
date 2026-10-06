// Entrenar: qué se predice, con qué columnas, cómo (automático o eligiendo el algoritmo) y cómo se examina.
// Debajo, los entrenamientos anteriores.
import { ml } from "../api.js";
import { h, icon, clear, toast, errorToast, confirmDialog, selectMenu, segmented, pageHead, emptyState, timeAgo, fullDate,
  rangeFill, busy } from "../ui.js";
import { nf } from "../charts.js";
import { navigate, projectPath, reloadProject, state } from "../app.js";
import { mlInfo, KINDS, kindIcon, TASKS, METRIC_HELP, metricName, fmtMetric, statusBadge, isLive, fmtDuration } from "../ml-common.js";

const TASK_ORDER = ["classification", "regression", "clustering"];
const SHORT_METRIC = { accuracy: "Exactitud", balanced_accuracy: "Equilibrada", f1_macro: "F1", r2: "R²", rmse: "RMSE", mae: "MAE" };
const AUTO_TEXT = {
  classification: "Prueba varios algoritmos con la validación cruzada y se queda con el de mejor nota. Siempre incluye la línea base (adivinar la clase más frecuente) para saber si los demás aprenden algo de verdad.",
  regression: "Prueba varios algoritmos con la validación cruzada y se queda con el de mejor nota. La línea base dice siempre la media: un buen modelo tiene que ganarla de sobra.",
  clustering: "Prueba de 2 a 8 grupos con k-medias y se queda con el número de grupos de mejor silueta (los grupos más separados entre sí).",
  images: "Prueba a mirar los píxeles a secas (k vecinos y regresión logística) y una red neuronal convolucional con color y en gris (solo la forma), y se queda con la que más acierta en el examen.",
};

// nombre de un candidato del modo automático (como runner.candidate_name)
function candidateName(cand, algos) {
  const a = algos.find((x) => x.key === cand.algorithm);
  const base = a ? a.name : cand.algorithm === "baseline" ? "Línea base (adivinar)" : cand.algorithm;
  const pr = cand.params || {};
  if (cand.algorithm === "tree" && pr.max_depth) return `${base} (profundidad ${pr.max_depth})`;
  if (cand.algorithm === "forest" && pr.n_trees) return `${base} (${pr.n_trees} árboles)`;
  if (cand.algorithm === "knn" && pr.k) return `${base} (k = ${pr.k})`;
  if (cand.algorithm === "cnn") return `Red convolucional (${pr.color === "gris" ? "solo forma" : "color"})`;
  return base;
}

const ALGO_ICONS = { logistic: "scale", linear: "scale", tree: "tree", forest: "tree", knn: "dots", bayes: "pulse", kmeans: "dots",
  cnn: "network", pixels_logistic: "scale", pixels_knn: "dots", baseline: "target" };

// columnas que pueden ser la que se predice
function targetOptions(cols, task) {
  return cols.filter((c) => {
    if (c.isId || c.kind === "text") return false;
    if (task === "regression") return c.kind === "number";
    if (task === "classification") return (c.kind === "category" && c.unique <= 50) || (c.kind === "number" && c.unique <= 20);
    return false;
  });
}

function guessTask(c) {
  if (!c) return "classification";
  return c.kind === "number" && c.unique > 20 ? "regression" : "classification";
}

export async function render(el) {
  const p = state.project;
  const info = await mlInfo();
  const page = h("div", { class: "page cq" });
  el.append(page);
  const head = pageHead({ icon: "flask", title: "Entrenar",
    sub: "Elige qué quieres que aprenda y cómo. Al terminar tendrás uno o varios modelos para comparar." });
  page.append(head);
  if (p.running) {
    page.append(h("div", { class: "notice info", style: { marginBottom: "16px", alignItems: "center" } }, h("span", { class: "spinner" }),
      h("div", { class: "grow" }, "Hay un entrenamiento en marcha en este proyecto."),
      h("a", { class: "btn sm", href: projectPath("jobs/" + p.running) }, "Ver cómo va", icon("arrowRight"))));
  }
  const images = p.kind === "images";
  if (!images && !p.data) {
    page.append(h("div", { class: "card" }, emptyState({ icon: "table", title: "Primero, los datos",
      text: "Sube la tabla con la que aprenderá el modelo.", action: h("a", { class: "btn primary", href: projectPath("data") }, icon("upload"), "Subir los datos") })));
    return null;
  }
  const classesWithImages = images ? ((p.data && p.data.classes) || []).filter((c) => c.count > 0) : [];
  if (images && classesWithImages.length < 2) {
    page.append(h("div", { class: "card" }, emptyState({ icon: "image", title: "Faltan imágenes",
      text: "Hacen falta al menos dos clases con imágenes (mejor unas 20 por clase).",
      action: h("a", { class: "btn primary", href: projectPath("data") }, icon("image"), "Añadir imágenes") })));
    page.append(jobsCard(p));
    return null;
  }

  const cols = images ? [] : p.profile.columns;
  const last = (p.jobs || []).find((j) => j.config && j.status === "done") || (p.jobs || [])[0];
  const lastCfg = last && last.config ? last.config : null;
  const example = p.example && info.examples.find((e) => e.id === p.example);

  // configuración (se rellena con la del último entrenamiento, el ejemplo o una suposición)
  const cfg = { mode: "auto", algorithm: null, params: {}, testSize: 0.2, folds: 5, seed: 42, metric: null, compare: null };
  if (images) {
    cfg.task = "images";
  } else {
    const guessTarget = example && example.target ? cols.find((c) => c.name === example.target)
      : [...cols].reverse().find((c) => !c.isId && c.kind !== "text" && c.kind !== "date");
    cfg.task = example ? example.task : guessTask(guessTarget);
    cfg.target = guessTarget ? guessTarget.name : null;
  }
  if (lastCfg) {
    for (const k of ["task", "target", "mode", "algorithm", "testSize", "folds", "seed", "metric", "compare"]) {
      if (lastCfg[k] !== undefined && lastCfg[k] !== null) cfg[k] = lastCfg[k];
    }
    cfg.params = { ...(lastCfg.params || {}) };
    if (images) cfg.task = "images";
  }
  if (!images && (!cfg.target || !cols.some((c) => c.name === cfg.target)) && cfg.task !== "clustering") {
    cfg.target = (targetOptions(cols, cfg.task)[0] || {}).name || null;
  }
  const usable = (c) => !c.isId && c.kind !== "text";
  let features = new Set(lastCfg && lastCfg.features ? lastCfg.features.filter((f) => cols.some((c) => c.name === f && usable(c)))
    : cols.filter(usable).map((c) => c.name));
  if (!features.size) features = new Set(cols.filter(usable).map((c) => c.name));
  if (cfg.task === "clustering") { if (cfg.compare) features.delete(cfg.compare); } else if (cfg.target) features.delete(cfg.target);
  // las columnas con las que aprende: nunca la que se predice (ni, al agrupar, la de comparar)
  const chosen = () => [...features].filter((f) => (cfg.task === "clustering" ? f !== cfg.compare : f !== cfg.target));

  const algos = () => info.algorithms[cfg.task] || [];
  const metrics = () => (info.metrics[cfg.task] || []);
  if (cfg.mode === "custom" && !algos().some((a) => a.key === cfg.algorithm)) cfg.algorithm = (algos()[0] || {}).key || null;

  const form = h("div", { class: "train-form" });
  const side = h("div", { class: "train-side" });
  page.append(h("div", { class: "train-layout" }, form, side));
  page.append(jobsCard(p));

  // --------------------------------------------------------- 1. la tarea
  const secTask = section(1, "¿Qué quieres hacer?", null);
  const secTarget = section(2, "¿Qué columna quieres predecir?", "La respuesta que el modelo aprenderá a dar. En las demás columnas tiene que estar la pista.");
  const secFeatures = section(3, "¿Con qué columnas aprende?", "Quita las que no deberían usarse: las que no tienen nada que ver o las que «chivan» la respuesta.");
  const secMode = section(images ? 1 : 4, "¿Cómo se entrena?", null);
  const secExam = section(images ? 2 : 5, "¿Cómo se examina?", "Para saber si ha aprendido de verdad (y no de memoria), se le examina con filas que no ha visto.");

  function paintTask() {
    const body = secTask.body;
    clear(body).append(h("div", { class: "tpl-list three", role: "radiogroup", "aria-label": "Tarea" }, TASK_ORDER.map((t) => {
      const T = TASKS[t];
      const possible = t === "clustering" || targetOptions(cols, t).length > 0;
      const radio = h("input", { type: "radio", name: "task", value: t, checked: cfg.task === t, class: "sr-only", disabled: !possible,
        onchange: () => {
          const prevTarget = cfg.task !== "clustering" ? cfg.target : null;
          cfg.task = t;
          cfg.metric = null;
          if (t !== "clustering" && !targetOptions(cols, t).some((c) => c.name === cfg.target)) cfg.target = (targetOptions(cols, t)[0] || {}).name || null;
          if (t === "clustering") {
            // al agrupar, lo que se predecía es buena columna para comparar los grupos (y no para aprender)
            const pc = cols.find((c) => c.name === prevTarget);
            if (!cfg.compare && pc && pc.kind === "category") cfg.compare = prevTarget;
            if (cfg.compare) features.delete(cfg.compare);
          } else if (cfg.target) features.delete(cfg.target);
          if (cfg.mode === "custom") { cfg.algorithm = (algos()[0] || {}).key; cfg.params = {}; }
          paintAll();
        } });
      return h("label", { class: "tpl-card" + (cfg.task === t ? " on" : "") + (possible ? "" : " disabled"), dataset: { task: t },
        title: possible ? null : (t === "regression" ? "No hay ninguna columna de números" : "No hay ninguna columna que sirva de clase") },
      radio, h("span", { class: "li-icon primary" }, icon(T.icon)),
      h("span", null, h("b", null, T.label), h("span", { class: "tpl-sub" }, T.text)));
    })));
  }

  // --------------------------------------------------------- 2. el objetivo
  function paintTarget() {
    const body = secTarget.body;
    clear(body);
    if (cfg.task === "clustering") {
      secTarget.title.textContent = "¿Con qué comparar los grupos? (opcional)";
      secTarget.help.textContent = "Agrupar no usa ninguna respuesta. Si tienes una columna con la «verdad» (la especie, por ejemplo), puedes ver después si los grupos coinciden con ella; no se usa para aprender.";
      const opts = [{ value: "", label: "No comparar" }, ...cols.filter((c) => c.kind === "category" && c.unique <= 30).map((c) => ({ value: c.name, label: c.name, sub: `${c.unique} valores` }))];
      const menu = selectMenu({ label: "Columna para comparar", value: cfg.compare || "", options: opts });
      menu.addEventListener("change", () => {
        cfg.compare = menu.value || null;
        if (cfg.compare) features.delete(cfg.compare);
        paintFeatures();
        paintSummary();
      });
      body.append(h("div", { style: { maxWidth: "360px" } }, menu));
      return;
    }
    secTarget.title.textContent = "¿Qué columna quieres predecir?";
    secTarget.help.textContent = cfg.task === "regression" ? "Un número: el modelo aprenderá a calcularlo a partir de las demás columnas."
      : "Una categoría: el modelo aprenderá a decir a cuál de sus valores pertenece cada fila.";
    const opts = targetOptions(cols, cfg.task).map((c) => ({ value: c.name, label: c.name,
      sub: c.kind === "number" ? `número · de ${nf(2).format(c.min)} a ${nf(2).format(c.max)}` : `${c.unique} valores: ${(c.top || []).slice(0, 3).map((t) => t.value).join(", ")}${c.unique > 3 ? "…" : ""}` }));
    const menu = selectMenu({ label: "Columna que se predice", value: cfg.target, options: opts, placeholder: "Elige una columna" });
    menu.addEventListener("change", () => {
      if (cfg.target) features.add(cfg.target);
      cfg.target = menu.value;
      features.delete(cfg.target);
      paintFeatures();
      paintSummary();
    });
    const tc = cols.find((c) => c.name === cfg.target);
    let preview = null;
    if (tc && cfg.task === "classification" && tc.top) {
      preview = h("div", { class: "auto-list" }, tc.top.slice(0, 8).map((t, i) =>
        h("span", { class: "auto-chip", style: { "--i": i } }, icon("tag"), `${t.value} · ${t.count}`)));
    } else if (tc && cfg.task === "regression") {
      preview = h("div", { class: "muted small" }, `De ${nf(2).format(tc.min)} a ${nf(2).format(tc.max)}; la media es ${nf(2).format(tc.mean)}.`);
    }
    body.append(h("div", { style: { maxWidth: "360px" } }, menu), preview);
  }

  // --------------------------------------------------------- 3. las columnas
  function paintFeatures() {
    const body = secFeatures.body;
    clear(body);
    const list = cols.filter((c) => c.name !== cfg.target && c.name !== cfg.compare);
    const toggles = h("div", { class: "feat-toggles" }, list.map((c) => {
      const ok = usable(c);
      const on = ok && features.has(c.name);
      const box = h("input", { type: "checkbox", checked: on, disabled: !ok, onchange: () => {
        if (box.checked) features.add(c.name); else features.delete(c.name);
        lbl.classList.toggle("on", box.checked);
        lbl.classList.toggle("off", !box.checked);
        paintSummary();
      } });
      const lbl = h("label", { class: "feat-toggle " + (ok ? (on ? "on" : "off") : "disabled"),
        title: ok ? `${KINDS[c.kind].label}` : c.isId ? "Parece un identificador: no se usa para aprender" : "Texto libre: no se usa para aprender" },
      box, kindIcon(c.kind), c.name);
      return lbl;
    }));
    const usableList = list.filter(usable);
    body.append(toggles, h("div", { class: "row small" },
      h("button", { class: "btn ghost sm", type: "button", onclick: () => { usableList.forEach((c) => features.add(c.name)); paintFeatures(); paintSummary(); } }, "Todas"),
      h("button", { class: "btn ghost sm", type: "button", onclick: () => { usableList.forEach((c) => features.delete(c.name)); paintFeatures(); paintSummary(); } }, "Ninguna")));
  }

  // --------------------------------------------------------- 4. el modo
  function paintMode() {
    const body = secMode.body;
    clear(body);
    const modes = [
      { value: "auto", icon: "wand", title: "Automático", text: "Prueba varios algoritmos y elige el mejor. Como el «ML automatizado» de Azure." },
      { value: "custom", icon: "settings", title: "Eligiendo tú", text: "Eliges el algoritmo y sus ajustes. Como un «script de entrenamiento personalizado»." },
    ];
    body.append(h("div", { class: "tpl-list two", role: "radiogroup", "aria-label": "Modo" }, modes.map((m) => {
      const radio = h("input", { type: "radio", name: "mode", value: m.value, checked: cfg.mode === m.value, class: "sr-only",
        onchange: () => {
          cfg.mode = m.value;
          if (m.value === "custom" && !algos().some((a) => a.key === cfg.algorithm)) { cfg.algorithm = (algos()[0] || {}).key; cfg.params = {}; }
          paintMode();
          paintSummary();
        } });
      return h("label", { class: "tpl-card" + (cfg.mode === m.value ? " on" : ""), dataset: { mode: m.value } }, radio,
        h("span", { class: "li-icon primary" }, icon(m.icon)),
        h("span", null, h("b", null, m.title), h("span", { class: "tpl-sub" }, m.text)));
    })));
    if (cfg.mode === "auto") {
      const cands = cfg.task === "clustering" ? [] : (info.auto[cfg.task] || []);
      body.append(h("p", { class: "lead-help" }, AUTO_TEXT[cfg.task]),
        cands.length ? h("div", { class: "auto-list" }, cands.map((c, i) => h("span", { class: "auto-chip", style: { "--i": i } },
          icon(ALGO_ICONS[c.algorithm] || "sparkle"), candidateName(c, algos())))) : null);
      return;
    }
    // personalizado: el algoritmo y sus ajustes
    const list = algos();
    if (cfg.task !== "clustering") {
      body.append(h("div", { class: "tpl-list auto", role: "radiogroup", "aria-label": "Algoritmo" }, list.map((a) => {
        const radio = h("input", { type: "radio", name: "algo", value: a.key, checked: cfg.algorithm === a.key, class: "sr-only",
          onchange: () => { cfg.algorithm = a.key; cfg.params = {}; paintMode(); paintSummary(); } });
        return h("label", { class: "tpl-card" + (cfg.algorithm === a.key ? " on" : ""), dataset: { algorithm: a.key } }, radio,
          h("span", { class: "li-icon primary" }, icon(ALGO_ICONS[a.key] || "sparkle")),
          h("span", null, h("b", null, a.name), h("span", { class: "tpl-sub" }, a.summary)));
      })));
    } else {
      cfg.algorithm = "kmeans";
      const a = list[0];
      body.append(h("p", { class: "lead-help" }, h("b", null, a.name + ": "), a.summary));
    }
    const algo = list.find((a) => a.key === cfg.algorithm);
    if (algo && algo.params.length) {
      body.append(h("div", { class: "params" }, algo.params.map((spec) => paramInput(spec))));
    } else if (algo) {
      body.append(h("p", { class: "muted small", style: { margin: 0 } }, "Este algoritmo no tiene ajustes."));
    }
    body.append(h("p", { class: "muted small", style: { margin: 0 } }, "El script equivalente en Python (scikit-learn",
      images ? " o PyTorch" : "", ") estará en la pestaña «Código» del modelo, por si quieres llevarlo a Azure."));
  }

  function paramInput(spec) {
    const cur = cfg.params[spec.key] ?? spec.default;
    if (spec.type === "choice") {
      const items = spec.options.map((o) => ({ key: String(o.value), label: o.label }));
      const control = spec.options.length <= 3
        ? segmented({ items, active: String(cur), label: spec.label, onChange: (k) => { cfg.params[spec.key] = typeOf(spec, k); paintSummary(); } })
        : (() => {
          const m = selectMenu({ label: spec.label, value: String(cur), options: items.map((i) => ({ value: i.key, label: i.label })) });
          m.addEventListener("change", () => { cfg.params[spec.key] = typeOf(spec, m.value); paintSummary(); });
          return m;
        })();
      return h("div", { class: "param", dataset: { param: spec.key } },
        h("div", { class: "param-top" }, h("span", { class: "param-label" }, spec.label)), control, h("div", { class: "hint" }, spec.help));
    }
    const digits = spec.type === "int" ? 0 : Math.max(0, -Math.floor(Math.log10(spec.step || 1) + 1e-9));
    const show = (v) => (spec.key === "k" && cfg.task === "clustering" && +v === 0 ? "Automático" : nf(digits).format(+v));
    const value = h("span", { class: "range-value" }, show(cur));
    const input = h("input", { type: "range", min: spec.min, max: spec.max, step: spec.step || 1, value: cur, "aria-label": spec.label,
      oninput: () => { cfg.params[spec.key] = spec.type === "int" ? Math.round(+input.value) : +input.value; value.textContent = show(input.value); rangeFill(input); paintSummary(); } });
    rangeFill(input);
    return h("div", { class: "param", dataset: { param: spec.key } },
      h("div", { class: "param-top" }, h("label", null, spec.label), value), input, h("div", { class: "hint" }, spec.help));
  }
  const typeOf = (spec, k) => (spec.options.some((o) => typeof o.value === "number") ? Number(k) : k);

  // --------------------------------------------------------- 5. el examen
  function paintExam() {
    const body = secExam.body;
    clear(body);
    if (cfg.task === "clustering") {
      secExam.help.textContent = "Agrupar no tiene examen (no hay respuesta correcta): se mide con la silueta, si cada fila está más cerca de los de su grupo que de los del grupo vecino.";
      body.append(seedInput());
      return;
    }
    secExam.help.textContent = "Para saber si ha aprendido de verdad (y no de memoria), se le examina con filas que no ha visto.";
    const n = images ? classesWithImages.reduce((a, c) => a + c.count, 0) : p.profile.rows;
    const tr = h("span", { class: "tr" }), te = h("span", { class: "te" });
    const bar = h("div", { class: "split-bar", "aria-hidden": "true" }, tr, te);
    const paintBar = () => {
      const nTe = Math.round(n * cfg.testSize);
      tr.style.flexGrow = String(1 - cfg.testSize);
      te.style.flexGrow = String(cfg.testSize);
      tr.textContent = `Entrenar: ${nf(0).format(n - nTe)}`;
      te.textContent = `Examen: ${nf(0).format(nTe)}`;
    };
    const val = h("span", { class: "range-value" }, nf(0).format(cfg.testSize * 100) + " %");
    const range = h("input", { type: "range", min: 10, max: 50, step: 5, value: Math.round(cfg.testSize * 100), "aria-label": "Parte para el examen",
      oninput: () => { cfg.testSize = +range.value / 100; val.textContent = range.value + " %"; rangeFill(range); paintBar(); paintSummary(); } });
    rangeFill(range);
    paintBar();
    body.append(h("div", { class: "param" }, h("div", { class: "param-top" }, h("label", null, "Parte que se esconde para el examen final"), val),
      range, bar, h("div", { class: "hint" }, "Lo normal es un 20 %: lo bastante para que el examen sea fiable sin quitarle demasiadas filas para aprender.")));
    if (!images) {
      const folds = segmented({ label: "Rondas de validación cruzada",
        items: [{ key: "0", label: "Sin" }, { key: "3", label: "3" }, { key: "5", label: "5" }, { key: "10", label: "10" }],
        active: String(cfg.folds), onChange: (k) => { cfg.folds = +k; paintSummary(); } });
      body.append(h("div", { class: "param" }, h("div", { class: "param-top" }, h("span", { class: "param-label" }, "Validación cruzada")),
        folds, h("div", { class: "hint" }, "Antes del examen final, reparte las filas de entrenamiento en trozos: aprende con todos menos uno y se examina con ese, una vez por trozo. La media de esas notas es más fiable que un solo examen (y es la que se usa para elegir en automático).")));
      const ms = metrics();
      if (!ms.some((m) => m.key === cfg.metric)) cfg.metric = ms[0].key;
      const helpEl = h("div", { class: "hint" }, METRIC_HELP[cfg.metric]);
      const metric = segmented({ label: "Métrica", items: ms.map((m) => ({ key: m.key, label: SHORT_METRIC[m.key] || m.name })), active: cfg.metric,
        onChange: (k) => { cfg.metric = k; helpEl.textContent = METRIC_HELP[k]; paintSummary(); } });
      body.append(h("div", { class: "param" }, h("div", { class: "param-top" }, h("span", { class: "param-label" }, "Con qué nota se compara")),
        metric, helpEl));
    }
    body.append(seedInput());
  }

  function seedInput() {
    const input = h("input", { type: "number", value: cfg.seed, min: 0, step: 1, style: { width: "110px" }, "aria-label": "Semilla",
      oninput: () => { cfg.seed = Math.max(0, parseInt(input.value, 10) || 0); } });
    return h("details", { class: "advanced" }, h("summary", null, icon("chevRight"), "Semilla"),
      h("div", null, h("div", { class: "param" }, h("div", { class: "param-top" }, h("label", null, "Semilla del azar"), input),
        h("div", { class: "hint" }, "Las filas del examen y los trozos se eligen al azar, pero con la misma semilla salen siempre los mismos: así dos entrenamientos se pueden comparar."))));
  }

  // --------------------------------------------------------- resumen
  const summaryList = h("ul", { class: "summary-list" });
  const trainBtn = h("button", { class: "btn primary train-btn", type: "button" }, icon("play"), "Entrenar");
  const warn = h("div", { class: "notice warning", hidden: true });
  side.append(h("div", { class: "card" }, h("div", { class: "card-head" }, icon("list"), h("h2", null, "Lo que va a pasar")),
    h("div", { class: "card-body col", style: { gap: "14px" } }, summaryList, warn, trainBtn,
      h("div", { class: "muted small" }, images ? "Una red neuronal tarda entre unos segundos y un par de minutos; puedes seguirlo en directo." : "Suele tardar unos segundos; puedes seguirlo en directo."))));

  function paintSummary() {
    clear(summaryList);
    const li = (ic, ...content) => summaryList.append(h("li", null, icon(ic), h("span", null, ...content)));
    let problem = null;
    if (images) {
      const n = classesWithImages.reduce((a, c) => a + c.count, 0);
      li("image", h("b", null, nf(0).format(n)), ` imágenes de ${classesWithImages.length} clases: `, classesWithImages.map((c) => c.name).join(", "), ".");
      li("eye", `Esconde el ${nf(0).format(cfg.testSize * 100)} % para el examen final.`);
      const small = classesWithImages.filter((c) => c.count < 2);
      if (small.length) problem = `A «${small[0].name}» le faltan imágenes (mínimo 2).`;
    } else {
      const nf_ = chosen().length;
      if (cfg.task !== "clustering") {
        li("target", "Aprende a predecir ", h("b", null, cfg.target ? `«${cfg.target}»` : "—"), cfg.task === "regression" ? " (un número)." : " (una categoría).");
        if (!cfg.target) problem = "Elige la columna que quieres predecir.";
      } else {
        li("dots", "Busca grupos de filas parecidas, sin ninguna respuesta.");
      }
      li("layers", "Con ", h("b", null, `${nf_} ${nf_ === 1 ? "columna" : "columnas"}`), nf_ ? ": " + chosen().slice(0, 4).join(", ") + (nf_ > 4 ? "…" : "") : ".");
      if (!nf_) problem = "Elige al menos una columna para aprender.";
      if (cfg.task !== "clustering") {
        li("eye", `Esconde el ${nf(0).format(cfg.testSize * 100)} % de las filas para el examen final.`);
        if (cfg.folds) li("refresh", `Validación cruzada de ${cfg.folds} rondas con el resto.`);
      }
    }
    if (cfg.mode === "auto") {
      const cands = cfg.task === "clustering" ? null : (info.auto[cfg.task] || []);
      li("wand", cands ? `Prueba ${cands.length} algoritmos y elige el de mejor ${metricName(cfg.metric || (images ? "accuracy" : metrics()[0].key)).toLowerCase()}.`
        : "Prueba de 2 a 8 grupos y elige por la silueta.");
    } else {
      const a = algos().find((x) => x.key === cfg.algorithm);
      li("settings", "Entrena ", h("b", null, a ? a.name.toLowerCase() : "—"), " con los ajustes elegidos.");
      if (!a) problem = "Elige un algoritmo.";
    }
    warn.hidden = !problem;
    clear(warn).append(icon("alert"), problem || "");
    trainBtn.disabled = !!problem || !!p.running;
  }

  trainBtn.addEventListener("click", () => busy(trainBtn, async () => {
    const body = images
      ? { mode: cfg.mode, algorithm: cfg.mode === "custom" ? cfg.algorithm : null, params: cfg.mode === "custom" ? cfg.params : {},
        testSize: cfg.testSize, seed: cfg.seed }
      : { task: cfg.task, target: cfg.task === "clustering" ? null : cfg.target, features: chosen(), mode: cfg.mode,
        algorithm: cfg.mode === "custom" ? cfg.algorithm : null, params: cfg.mode === "custom" ? cfg.params : {},
        metric: cfg.metric, testSize: cfg.testSize, folds: cfg.folds, seed: cfg.seed, compare: cfg.task === "clustering" ? cfg.compare : null };
    try {
      const job = await ml.train(p.id, body);
      reloadProject().catch(() => {});
      navigate(projectPath("jobs/" + job.id));
    } catch (e) { errorToast(e); }
  }));

  function paintAll() {
    paintTask();
    paintTarget();
    paintFeatures();
    paintMode();
    paintExam();
    paintSummary();
  }
  if (images) {
    form.append(secMode.el, secExam.el);
    paintMode();
    paintExam();
    paintSummary();
  } else {
    form.append(secTask.el, secTarget.el, secFeatures.el, secMode.el, secExam.el);
    paintAll();
  }
  return null;
}

function section(n, title, help) {
  const titleEl = h("span", null, title);
  const helpEl = h("p", { class: "lead-help" }, help || "");
  const body = h("div", { class: "col", style: { gap: "14px" } });
  const el = h("div", { class: "card form-sec" }, h("div", { class: "card-head" }, h("h2", null, h("span", { class: "sec-num" }, String(n)), titleEl)),
    h("div", { class: "card-body" }, helpEl, body));
  if (!help) helpEl.hidden = true;
  return { el, body, title: titleEl, help: helpEl };
}

// ------------------------------------------------------------ historial
function jobsCard(p) {
  const jobs = p.jobs || [];
  const card = h("div", { class: "card job-list", style: { marginTop: "22px" } },
    h("div", { class: "card-head", style: { paddingBottom: "12px" } }, icon("history"), h("h2", null, "Entrenamientos"),
      h("span", { class: "badge" }, String(jobs.length)), h("span", { class: "help" }, "Cada uno guarda su configuración, sus pasos y sus modelos.")));
  if (!jobs.length) {
    card.append(h("div", { class: "muted small", style: { padding: "0 18px 18px" } }, "Todavía no has entrenado nada en este proyecto."));
    return card;
  }
  const list = h("div", { class: "list" });
  for (const j of jobs) {
    const open = () => navigate(projectPath("jobs/" + j.id));
    const dur = j.finishedAt && j.createdAt ? fmtDuration(j.finishedAt - j.createdAt) : "";
    const del = h("button", { class: "btn ghost sm icon-only", type: "button", "aria-label": "Borrar el entrenamiento", title: "Borrar (con sus modelos)",
      onclick: async (e) => {
        e.stopPropagation();
        if (!(await confirmDialog(`Se borrará «${j.name}» con los modelos que creó.`, { title: "Borrar el entrenamiento", okLabel: "Borrar", danger: true }))) return;
        try {
          await ml.deleteJob(p.id, j.id);
          await reloadProject();
          toast("Entrenamiento borrado", "success");
          navigate(projectPath("train"));
        } catch (err) { errorToast(err); }
      } }, icon("trash"));
    list.append(h("div", { class: "list-item", tabindex: "0", role: "link", onclick: open, onkeydown: (e) => { if (e.key === "Enter") open(); } },
      h("span", { class: "li-icon" + (j.status === "done" ? " success" : isLive(j.status) ? " primary" : j.status === "failed" ? " warning" : "") },
        icon(j.config && j.config.mode === "custom" ? "settings" : "wand")),
      h("div", { class: "grow" }, h("div", { class: "title ellipsis" }, j.name),
        h("div", { class: "meta small muted" }, statusBadge(j.status),
          h("span", { title: fullDate(j.createdAt) }, timeAgo(j.createdAt)), dur ? h("span", null, "· " + dur) : null,
          j.error && j.status === "failed" ? h("span", { class: "ellipsis", style: { maxWidth: "340px" } }, "· " + j.error) : null)),
      j.best ? h("div", { class: "num small" }, h("div", { class: "job-metric" }, fmtMetric(j.best.metric, j.best.value)),
        h("div", { class: "faint ellipsis", style: { maxWidth: "200px" } }, j.best.name)) : null,
      h("span", { class: "actions" }, del), icon("chevRight", "chev")));
  }
  card.append(list);
  return card;
}
