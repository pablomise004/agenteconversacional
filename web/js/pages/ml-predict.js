// Probar un modelo: una fila escrita a mano (o sacada de los datos) o una imagen (fichero o cámara), con la
// predicción al momento y el porqué. Al cambiar un valor se vuelve a predecir: así se ve qué le influye.
import { ml } from "../api.js";
import { h, icon, clear, toast, errorToast, selectMenu, pageHead, emptyState, debounce, busy, downloadFile } from "../ui.js";
import { nf, barList } from "../charts.js";
import { pixelImage } from "../ml-charts.js";
import { navigate, projectPath, state } from "../app.js";
import { kindIcon, fmtMetric, fmtNum, metricName, defaultModel, dropZone, sampleFrom, sampleFromFile, webcam, TASKS } from "../ml-common.js";
import { explanationView, preparedView, probabilityBars, cnnInsideView } from "../ml-views.js";

export async function render(el, params, query) {
  const p = state.project;
  const page = h("div", { class: "page cq" });
  el.append(page);
  const models = p.models || [];
  if (!models.length) {
    page.append(pageHead({ icon: "target", title: "Probar", sub: "Prueba un modelo con datos nuevos." }),
      h("div", { class: "card" }, emptyState({ icon: "flask", title: "Todavía no hay ningún modelo", text: "Entrena uno y vuelve aquí para probarlo.",
        action: h("a", { class: "btn primary", href: projectPath("train") }, icon("flask"), "Entrenar") })));
    return null;
  }
  const wanted = query && query.get("model");
  const chosen = models.find((x) => x.id === wanted) || defaultModel(p);
  const publishedId = p.published && p.published.modelId;
  const picker = selectMenu({ label: "Modelo", value: chosen.id, className: "w-model",
    options: models.map((x) => ({ value: x.id, label: x.name,
      sub: `${metricName(x.metric)} ${fmtMetric(x.metric, x.value)}` + (x.id === publishedId ? " · publicado" : x.best ? " · el mejor" : "") })) });
  picker.addEventListener("change", () => navigate(projectPath("predict") + "?model=" + encodeURIComponent(picker.value)));
  page.append(pageHead({ icon: "target", title: "Probar",
    sub: p.kind === "images" ? "Dale una imagen que no haya visto y mira qué dice y dónde se fija."
      : "Escribe una fila (o saca una de los datos) y mira qué predice y por qué. Cambia un valor y verás cómo cambia la respuesta.",
    actions: [h("div", { style: { width: "min(340px, 100%)" } }, picker)] }));
  let m;
  try {
    m = await ml.model(p.id, chosen.id);
  } catch (e) {
    page.append(h("div", { class: "notice danger" }, icon("alert"), e.message));
    return null;
  }
  return p.kind === "images" ? imagesPredict(page, p, m) : tablePredict(page, p, m);
}

// ------------------------------------------------------------------ tabla
function tablePredict(page, p, m) {
  const r = m.report;
  const schema = m.schema;
  const fields = new Map();
  const form = h("div", { class: "predict-form" });
  let real = null;  // { value, row }: la respuesta de verdad, si la fila sale de los datos
  for (const col of schema.columns) {
    let control;
    if (col.kind === "category") {
      control = selectMenu({ label: col.name, value: col.values[0] ?? "", search: col.values.length > 10,
        options: [...col.values.map((v) => ({ value: v, label: v })), { value: "", label: "(vacío)" }] });
      control.addEventListener("change", changed);
    } else {
      control = h("input", { type: "text", inputmode: col.kind === "number" ? "decimal" : null, "aria-label": col.name,
        placeholder: col.kind === "date" ? "AAAA-MM-DD" : col.example != null ? fmtNum(col.example) : "",
        value: col.example == null ? "" : col.kind === "number" ? String(+col.example.toFixed(4)).replace(".", ",") : String(col.example),
        oninput: changed });
    }
    fields.set(col.name, { col, control });
    form.append(h("label", { class: "field" }, h("span", null, kindIcon(col.kind), col.name), control));
  }
  const fillBtn = h("button", { class: "btn", type: "button", title: "Pone los valores de una fila al azar de la tabla (y te dice la respuesta de verdad)" },
    icon("refresh"), "Una fila de los datos");
  const predictBtn = h("button", { class: "btn primary", type: "button" }, icon("play"), "Predecir");
  const result = h("div", { class: "predict-col" }, h("div", { class: "card" }, emptyState({ icon: "target", title: "Aquí saldrá la predicción",
    text: "Rellena los valores (o pulsa «Una fila de los datos») y pulsa «Predecir»." })));
  page.append(h("div", { class: "predict-layout" },
    h("div", { class: "card" }, h("div", { class: "card-head" }, icon("edit"), h("h2", null, "Tu fila")),
      h("div", { class: "card-body col", style: { gap: "14px" } },
        h("p", { class: "muted small", style: { margin: 0 } }, r.task === "clustering" ? "Las columnas con las que se agrupó." : `Las columnas con las que aprendió a predecir «${r.target}».`),
        form, h("div", { class: "row wrap" }, fillBtn, h("span", { class: "spacer" }), predictBtn))),
    result));
  page.append(batchCard(p, m));

  function record() {
    const rec = {};
    for (const [name, { col, control }] of fields) {
      const v = control.value;
      if (v === "" || v == null) { rec[name] = null; continue; }
      rec[name] = col.kind === "number" ? Number(String(v).replace(/\s/g, "").replace(",", ".")) : v;
      if (col.kind === "number" && !isFinite(rec[name])) rec[name] = v;  // que lo convierta el servidor (o lo deje vacío)
    }
    return rec;
  }
  let seq = 0;
  async function predict() {
    const my = ++seq;
    try {
      const res = await ml.predict(p.id, m.id, { rows: [record()], explain: true });
      if (my !== seq) return;
      paintResult(res.predictions[0]);
    } catch (e) { if (my === seq) errorToast(e); }
  }
  const auto = debounce(() => { if (started) predict(); }, 350);
  let started = false;
  function changed() { real = null; auto(); }
  predictBtn.addEventListener("click", () => busy(predictBtn, async () => { started = true; await predict(); }));
  fillBtn.addEventListener("click", () => busy(fillBtn, async () => {
    try {
      const total = (p.data && p.data.rows) || 1;
      const res = await ml.rows(p.id, Math.floor(Math.random() * total), 1);
      const row = res.rows[0] || [];
      const byName = Object.fromEntries(res.columns.map((c, i) => [c, row[i]]));
      for (const [name, { col, control }] of fields) {
        const v = byName[name] ?? "";
        // la tabla se guarda con punto decimal; en el formulario, con coma (como lo que sale relleno al abrir)
        control.value = col.kind === "number" ? String(v).replace(".", ",") : v;
      }
      const truth = r.target ? byName[r.target] : null;
      real = truth != null && truth !== "" ? { value: truth, row: res.offset + 1 } : null;
      started = true;
      await predict();
    } catch (e) { errorToast(e); }
  }));

  function paintResult(item) {
    clear(result);
    const big = r.task === "regression" ? fmtNum(item.prediction) : r.task === "clustering" ? `Grupo ${item.prediction}` : String(item.prediction);
    const where = real ? ` (fila ${nf(0).format(real.row)} de la tabla)` : "";
    const truth = real ? h("span", { class: "pred-real" }, r.task === "regression"
      ? [icon("info"), `De verdad es ${fmtNum(Number(real.value))}${where}: se equivoca en ${fmtNum(Math.abs(item.prediction - Number(real.value)))}`]
      : String(real.value) === String(item.prediction) ? [h("span", { class: "status-icon good" }, "✓"), `Acierta: de verdad es «${real.value}»${where}`]
        : [h("span", { class: "status-icon critical" }, "✗"), `Falla: de verdad es «${real.value}»${where}`]) : null;
    result.append(h("div", { class: "card" }, h("div", { class: "card-body pred-result", style: { paddingTop: "18px" } },
      h("div", { class: "pred-big" }, h("span", { class: "label" }, r.task === "clustering" ? "Va al" : `«${r.target}» predicho`),
        h("span", { class: "value" }, big),
        item.confidence != null ? h("span", { class: "conf" }, `${nf(0).format(item.confidence * 100)} % de seguridad`) : null),
      truth,
      item.probabilities ? probabilityBars(item.probabilities) : null)));
    const why = explanationView(item.explanation, { task: r.task, classes: r.classes, prediction: item.prediction, target: r.target });
    if (why) result.append(h("div", { class: "card" }, h("div", { class: "card-head" }, icon("eye"), h("h2", null, "¿Por qué?"),
      h("span", { class: "help" }, r.name)), h("div", { class: "card-body" }, why)));
    const prep = preparedView(item.prepared);
    if (prep) result.append(h("div", { class: "card" }, h("details", { class: "advanced", style: { padding: "14px 18px" } },
      h("summary", null, icon("chevRight"), "Cómo se ha preparado tu fila"), h("div", null,
        h("p", { class: "muted small", style: { margin: 0 } }, "Los mismos pasos que con las filas de entrenamiento: vacíos, categorías en 0 y 1 y números escalados."),
        prep))));
  }
  return null;
}

// ---------------------------------------------------------- por lotes (CSV)
// Muchas filas a la vez: sube un CSV y descarga el mismo con la predicción de cada fila (en Azure, un punto de
// conexión por lotes). Si el fichero trae la columna que se predice, dice cuánto acierta.
function batchCard(p, m) {
  const r = m.report;
  const what = r.task === "clustering" ? "el grupo de cada fila" : r.task === "classification" ? `«${r.target}» y su seguridad` : `«${r.target}»`;
  const out = h("div", { class: "col batch-out", style: { gap: "14px" } });
  const zone = dropZone({ title: "Arrastra un CSV o haz clic", text: `El mismo fichero vuelve con ${what} al final de cada fila.`,
    accept: ".csv,.tsv,.txt,text/csv,text/plain", compact: true, iconName: "upload", onFiles: (files) => run(files[0]) });
  async function run(file) {
    clear(out).append(h("div", { class: "muted small row", style: { gap: "8px" } }, h("span", { class: "spinner" }), `Prediciendo «${file.name}»…`));
    try {
      paint(await ml.batch(p.id, m.id, file), file.name);
    } catch (e) { clear(out); errorToast(e); }
  }
  function paint(res, name) {
    const s = res.summary;
    const file = name.replace(/\.[^.]+$/, "") + "-predicciones.csv";
    const download = h("button", { class: "btn primary", type: "button", onclick: () => downloadFile(file, res.csv, "text/csv;charset=utf-8") },
      icon("download"), `Descargar ${file}`);
    const facts = h("div", { class: "data-facts" }, h("span", null, h("b", null, nf(0).format(res.rows)), " filas"),
      h("span", null, "columnas nuevas: ", h("b", null, res.newColumns.join(", "))));
    let check = null;
    if (s.check && r.task === "classification") {
      const share = s.check.right / s.check.rows;
      check = h("span", { class: "pred-real" }, h("span", { class: "status-icon " + (share >= 0.85 ? "good" : share >= 0.6 ? "warn" : "critical") }, share >= 0.85 ? "✓" : share >= 0.6 ? "~" : "✗"),
        `El fichero trae «${r.target}»: acierta en ${nf(0).format(s.check.right)} de ${nf(0).format(s.check.rows)} filas (${nf(1).format(share * 100)} %).`);
    } else if (s.check && r.task === "regression") {
      check = h("span", { class: "pred-real" }, icon("info"), `El fichero trae «${r.target}»: se equivoca de media en ${fmtNum(s.check.mae)}`
        + (s.check.r2 != null ? ` (R² ${nf(3).format(s.check.r2)}).` : "."));
    }
    const summary = s.counts
      ? barList({ items: s.counts.map((c) => ({ label: r.task === "clustering" ? `Grupo ${c.label}` : c.label, sub: nf(0).format(c.count), value: c.count, tip: `${c.count} filas` })),
        format: (v) => nf(0).format(v), labelWidth: 140 })
      : h("div", { class: "kv-table small" },
        h("div", null, "Media"), h("div", null, h("b", null, fmtNum(s.mean))),
        h("div", null, "La más baja"), h("div", null, h("b", null, fmtNum(s.min))),
        h("div", null, "La más alta"), h("div", null, h("b", null, fmtNum(s.max))));
    // en el fichero, lo nuevo va al final; aquí, delante (con muchas columnas, al final quedaba fuera de la vista)
    const firstNew = res.columns.length - res.newColumns.length;
    const order = [...res.columns.keys()].slice(firstNew).concat([...res.columns.keys()].slice(0, firstNew));
    const table = h("div", { class: "table-wrap" }, h("table", { class: "table batch-preview" },
      h("thead", null, h("tr", null, order.map((j) => h("th", { scope: "col", class: j >= firstNew ? "new" : null }, res.columns[j])))),
      h("tbody", null, res.preview.map((row) => h("tr", null, order.map((j) => h("td", { class: j >= firstNew ? "new" : null }, row[j])))))));
    clear(out).append(...[  // (append(null) escribiría «null»)
      res.missingColumns.length ? h("div", { class: "notice warning" }, icon("alert"),
        `Le faltaban columnas con las que aprendió el modelo (${res.missingColumns.join(", ")}): se han rellenado como los vacíos.`) : null,
      facts, check, summary,
      h("div", { class: "chart-title" }, `Las primeras ${res.preview.length} filas`), table,
      h("div", { class: "row wrap" }, download)].filter(Boolean));
  }
  return h("div", { class: "card batch-card" }, h("div", { class: "card-head" }, icon("layers"), h("h2", null, "Muchas filas a la vez"),
    h("span", { class: "help" }, "un CSV entero")),
  h("div", { class: "card-body col", style: { gap: "14px" } },
    h("p", { class: "muted small", style: { margin: 0 } }, "Sube un CSV con las columnas del modelo y descarga la predicción de todas sus filas (en Azure, un punto de conexión por lotes). Si el fichero trae la respuesta, te dice cuánto acierta."),
    zone, out));
}

// ---------------------------------------------------------------- imágenes
function imagesPredict(page, p, m) {
  const r = m.report;
  let thumbs = null, all = [];  // las imágenes del proyecto (id → miniatura): para los vecinos y «Una imagen de los datos»
  async function loadThumbs() {
    if (thumbs) return;
    try {
      const data = await ml.images(p.id);
      all = data.classes.flatMap((c) => c.images.map((i) => ({ id: i.id, thumb: i.thumb, label: c.name })));
      thumbs = new Map(all.map((i) => [i.id, i.thumb]));
    } catch (e) { thumbs = new Map(); }
  }
  const preview = h("div", { class: "img-preview" });
  const result = h("div", { class: "predict-col" }, h("div", { class: "card" }, emptyState({ icon: "image", title: "Aquí saldrá lo que ve",
    text: "Elige una imagen o usa la cámara." })));
  let cam = null, liveTimer = 0, busyLive = false;
  const camBox = h("div", { hidden: true });
  const liveBox = h("div", { class: "live-switch", hidden: true });
  const stopCam = () => {
    clearInterval(liveTimer);
    liveTimer = 0;
    if (cam) cam.stop();
    cam = null;
    clear(camBox);
    camBox.hidden = true;
    liveBox.hidden = true;
    clear(camBtn).append(icon("camera"), "Usar la cámara");
  };
  async function predict(sample, explain = true, real = null) {
    clear(preview).append(h("img", { src: sample.thumb, alt: "La imagen que se prueba" }),
      h("div", { class: "muted small" }, `Reducida a 64 × 64 píxeles${r.learned && r.learned.layers ? ` (la red la ve a ${r.params && r.params.size || 32} × ${r.params && r.params.size || 32})` : ""}.`));
    const res = await ml.predict(p.id, m.id, { images: [sample.b64], explain });
    paintResult(res.predictions[0], sample.thumb, explain, real);
  }
  const zone = dropZone({ title: "Arrastra una imagen o haz clic", text: "JPG, PNG, WebP…", accept: "image/*", compact: true, iconName: "image",
    onFiles: async (files) => {
      stopCam();
      try { await predict(await sampleFromFile(files[0])); } catch (e) { errorToast(e); }
    } });
  const camBtn = h("button", { class: "btn", type: "button" }, icon("camera"), "Usar la cámara");
  // como «Una fila de los datos» en las tablas: una al azar del proyecto, y te dice qué es de verdad
  const pickBtn = h("button", { class: "btn", type: "button", title: "Una imagen al azar del proyecto (puede ser de las que usó para aprender)" },
    icon("refresh"), "Una imagen de los datos");
  pickBtn.addEventListener("click", () => busy(pickBtn, async () => {
    stopCam();
    try {
      await loadThumbs();
      if (!all.length) { toast("Este proyecto todavía no tiene imágenes", "info"); return; }
      const pick = all[Math.floor(Math.random() * all.length)];
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error("No se ha podido abrir la imagen"));
        im.src = pick.thumb;
      });
      await predict(sampleFrom(img, img.naturalWidth, img.naturalHeight), true, pick.label);
    } catch (e) { errorToast(e); }
  }));
  const liveInput = h("input", { type: "checkbox" });
  liveInput.addEventListener("change", () => {
    clearInterval(liveTimer);
    liveTimer = 0;
    if (liveInput.checked && cam) liveTimer = setInterval(() => { if (!busyLive && cam) cam.shoot(); }, 900);
  });
  liveBox.append(h("label", { class: "switch" }, liveInput, h("span", null, "En directo", h("div", { class: "muted small" }, "Una foto cada segundo, sin la explicación (va más rápido)."))));
  camBtn.addEventListener("click", () => {
    if (cam) { stopCam(); return; }
    cam = webcam({ single: true, onCapture: (sample) => {
      if (!liveTimer) { predict(sample, true).catch(errorToast); return; }
      busyLive = true;  // en directo, sin explicación y de una en una
      predict(sample, false).catch(() => {}).finally(() => { busyLive = false; });
    } });
    clear(camBox).append(cam.el);
    camBox.hidden = false;
    liveBox.hidden = false;
    liveInput.checked = false;
    clear(camBtn).append(icon("x"), "Cerrar la cámara");
  });
  page.append(h("div", { class: "predict-layout" },
    h("div", { class: "card" }, h("div", { class: "card-head" }, icon("image"), h("h2", null, "Tu imagen")),
      h("div", { class: "card-body img-pick" }, zone, h("div", { class: "row wrap" }, pickBtn, camBtn), camBox, liveBox, preview,
        h("p", { class: "muted small", style: { margin: 0 } }, `Clases que conoce: ${r.classes.join(", ")}. Si le das algo que no es ninguna, dirá la que más se le parezca: no sabe decir «ninguna».`))),
    result));

  async function paintResult(item, image, explain, real) {
    clear(result);
    const truth = real == null ? null : h("span", { class: "pred-real" }, real === item.prediction
      ? [h("span", { class: "status-icon good" }, "✓"), `Acierta: de verdad es «${real}»`]
      : [h("span", { class: "status-icon critical" }, "✗"), `Falla: de verdad es «${real}»`]);
    result.append(h("div", { class: "card" }, h("div", { class: "card-body pred-result", style: { paddingTop: "18px" } },
      h("div", { class: "pred-big" }, h("span", { class: "label" }, "Dice que es"), h("span", { class: "value" }, item.prediction),
        h("span", { class: "conf" }, `${nf(0).format(item.confidence * 100)} % de seguridad`)),
      truth, probabilityBars(item.probabilities))));
    if (!explain) return;
    if (item.inside) {
      result.append(h("div", { class: "card" }, h("div", { class: "card-head" }, icon("network"), h("h2", null, "Por dentro de la red")),
        h("div", { class: "card-body" }, cnnInsideView(item.inside, r.classes, image))));
    } else if (item.neighbors) {
      await loadThumbs();
      result.append(h("div", { class: "card" }, h("div", { class: "card-head" }, icon("dots"), h("h2", null, "Las imágenes más parecidas")),
        h("div", { class: "card-body col", style: { gap: "12px" } },
          h("p", { class: "muted small", style: { margin: 0 } }, "Compara píxel a píxel con las de entrenamiento y mira qué son las más parecidas. No entiende de formas: dos fotos con el mismo fondo se le parecen mucho."),
          h("div", { class: "mistakes" }, item.neighbors.map((n, i) => h("div", { class: "mistake", style: { "--i": i } },
            n.id && thumbs.get(n.id) ? pixelImage(thumbs.get(n.id), { size: 96, label: n.label }) : h("div", { class: "class-empty" }, "—"),
            h("span", { class: "pred" }, n.label), h("span", { class: "real" }, `distancia ${nf(1).format(n.distance)}`)))))));
    } else if (item.scores) {
      result.append(h("div", { class: "card" }, h("div", { class: "card-head" }, icon("scale"), h("h2", null, "La puntuación de cada clase")),
        h("div", { class: "card-body col", style: { gap: "10px" } },
          h("p", { class: "muted small", style: { margin: 0 } }, "Cada clase suma los píxeles multiplicados por sus pesos (en «Lo que ha aprendido» se ven como imágenes); gana la que más puntúa."),
          h("div", { class: "kv-table" }, [...item.scores].sort((a, b) => b.score - a.score).map((s) => [h("div", null, s.class), h("div", null, h("b", null, nf(2).format(s.score)))])))));
    }
  }
  return { destroy: stopCam };
}
