// "Entrenar": ver paso a paso cómo aprende el agente y qué ha aprendido.
import { api } from "../api.js";
import { h, icon, clear, errorToast, toast, pageHead, countUp, dataTable, stagger, busy } from "../ui.js";
import { lineChart, barList, divergingBars, scatter, heatmap, meter, format } from "../charts.js";
import { agentPath, state } from "../app.js";

const int = (v) => format.nf(0).format(v);
const pctf = (v) => (v == null ? "—" : format.nf(0).format(v * 100) + " %");
const KIND_SHORT = { w: "palabra", b: "pareja", e: "entidad", c: "letras", p: "signo" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const msText = (ms) => (ms < 1000 ? int(ms) + " ms" : format.nf(1).format(ms / 1000) + " s");

function tile(ic, label, value, fmt, sub) {
  return h("div", { class: "card stat" }, h("span", { class: "s-icon" }, icon(ic)), h("div", { class: "l" }, label),
    countUp(h("div", { class: "v" }), value, fmt), sub ? h("div", { class: "faint small" }, sub) : null);
}

export async function render(el, _params, query) {
  const agentId = state.agent.id;
  const page = h("div", { class: "page learn" });
  el.append(page);
  let model;
  try {
    model = await api.model(agentId);
  } catch (e) {
    page.append(h("div", { class: "notice danger" }, icon("alert"), e.message));
    return null;
  }
  let explained = null;
  let mapA = null;
  let mapB = null;
  let includeChars = false;
  let destroyed = false;
  const names = () => Object.fromEntries(state.agent.intents.map((i) => [i.id, i.name]));

  // ---------------------------------------------------------------- cabecera
  const trainBtn = h("button", { class: "btn primary", type: "button", onclick: () => trainAnimated() }, icon("play"), "Entrenar paso a paso");
  const statsBox = h("div", { class: "grid-stats" });
  page.append(
    pageHead({
      icon: "pulse", title: "Entrenar y entender el modelo",
      sub: "El agente se reentrena solo cada vez que guardas un cambio. Aquí puedes ver qué hace por dentro, qué ha aprendido y cuánto acierta.",
      actions: [trainBtn],
    }),
    h("div", { class: "cq" }, statsBox));

  function drawStats(animate = true) {
    const r = model.report;
    const t = r.timing;
    const total = (t.prepare + t.vectorize + t.sgd + t.index) * 1000;
    const ev = model.evaluation;
    clear(statsBox).append(
      tile("chat", "Intenciones", r.intents, int, r.negativePhrases ? `+ ${int(r.negativePhrases)} ejemplos negativos` : null),
      tile("list", "Frases de entrenamiento", r.phrases, int),
      tile("cpu", "Rasgos aprendidos", r.features, int),
      tile("zap", "Tiempo de entrenamiento", total, msText),
      tile("target", "Acierto en el examen", ev ? ev.accuracy : null, pctf, ev ? `${ev.correct} de ${ev.total} frases` : "haz el examen abajo"));
    if (animate) stagger(statsBox);
  }

  // ---------------------------------------------------- pasos del entrenamiento
  const stepsBox = h("ol", { class: "steps" });
  const stepsCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, icon("layers"), h("h2", null, "Qué hace al entrenar"),
      h("span", { class: "help" }, "Pulsa «Entrenar paso a paso» para verlo animado.")),
    h("div", { class: "card-body" }, stepsBox));
  page.append(stepsCard);
  let stepNodes = [];
  let curves = [];

  async function exampleExplain(text) {
    try { return await api.explain(agentId, text); } catch (e) { return null; }
  }

  async function drawSteps() {
    const r = model.report;
    const ex = r.example ? await exampleExplain(r.example) : null;
    const t = r.timing;
    const ms = (v) => (v * 1000 < 1 ? "<1" : int(v * 1000)) + " ms";
    clear(stepsBox);
    curves = [];
    const perIntent = model.topFeatures.filter((i) => !i.isFallback).map((i) => ({ label: i.name, value: i.phrases, tip: "frases" }))
      .sort((a, b) => b.value - a.value);
    const exTokens = ex ? ex.tokens.filter((tk) => tk.kind !== "symbol") : [];
    const steps = [
      {
        title: "Reunir los ejemplos",
        time: null,
        text: `${int(r.phrases)} frases de entrenamiento repartidas en ${int(r.intents)} intenciones` +
          (r.negativePhrases ? ` y ${int(r.negativePhrases)} ejemplos negativos (las frases del fallback).` : "."),
        more: "Cada frase es un ejemplo de algo que diría un usuario. El modelo aprenderá qué diferencia a unas intenciones de otras.",
        viz: () => barList({ items: perIntent.slice(0, 8), format: (v) => int(v) + " frases", labelWidth: 140 }),
      },
      {
        title: "Trocear y normalizar (tokenizar)",
        time: t.prepare,
        text: `${int(r.tokens)} tokens. ${int(r.vocabulary)} palabras distintas que se reducen a ${int(r.stems)} raíces.`,
        more: "Separa las palabras, pasa a minúsculas, quita tildes, expande abreviaturas (q → que, xfa → por favor) y deja cada palabra en su raíz: reservar, reserva y reservas → «reserv».",
        viz: () => ex ? tokenTable(exTokens) : null,
      },
      {
        title: "Marcar las entidades",
        time: null,
        text: `${int(r.annotations)} entidades anotadas en las frases.`,
        more: "Lo marcado como entidad se sustituye por su tipo: «una barbacoa» y «una hawaiana» pasan a ser «una @pizza». Así aprende la estructura de la frase y no cada valor por separado.",
        viz: () => ex ? placeholderView(ex) : null,
      },
      {
        title: "Convertir cada frase en números (rasgos)",
        time: t.vectorize,
        text: `${int(r.features)} rasgos distintos: ${int(r.featureKinds.words)} palabras, ${int(r.featureKinds.pairs)} parejas de palabras, ${int(r.featureKinds.entities)} entidades y ${int(r.featureKinds.chars)} trozos de letras.`,
        more: "Cada rasgo lleva un peso TF-IDF: pesa más cuantas menos intenciones lo usan. «quiero» sale en muchas y apenas cuenta; «reservar» solo en una, así que cuenta mucho. Los trozos de letras ayudan con las faltas de ortografía.",
        viz: () => ex ? barList({
          items: ex.features.filter((f) => f.kind !== "c").slice(0, 8).map((f) => ({ label: f.label, sub: KIND_SHORT[f.kind], value: f.weight, tip: `${f.kindLabel} · peso TF-IDF` })),
          format: (v) => format.nf(3).format(v), labelWidth: 170,
        }) : null,
      },
      {
        title: "Aprender los pesos (regresión logística)",
        time: t.sgd,
        text: `${r.epochs} épocas: en cada una repasa todas las frases y ajusta los pesos un poco para equivocarse menos.`,
        more: lossText(r),
        viz: () => learningCurves(r),
      },
      {
        title: "Preparar la memoria",
        time: t.index,
        text: `${int(r.templates)} frases guardadas como plantillas exactas y un índice para buscar las frases más parecidas.`,
        more: "Si alguien escribe exactamente una frase de entrenamiento, la confianza es del 100 %. El parecido con las frases conocidas sirve también para detectar lo que está fuera de tema.",
        viz: null,
      },
    ];
    stepNodes = steps.map((st, i) => {
      const viz = st.viz ? st.viz() : null;
      return h("li", { class: "step done" },
        h("div", { class: "step-num" }, String(i + 1)),
        h("div", { class: "step-body" },
          h("div", { class: "row" }, h("b", null, st.title), h("span", { class: "spacer" }),
            st.time != null ? h("span", { class: "step-time", title: "Tiempo de este paso" }, ms(st.time)) : null),
          h("div", null, st.text),
          h("div", { class: "muted small" }, st.more),
          viz ? h("div", { class: "step-viz" }, viz) : null));
    });
    stepsBox.append(...stepNodes);
    const total = (t.prepare + t.vectorize + t.sgd + t.index) * 1000;
    stepsBox.append(h("li", { class: "step done final" }, h("div", { class: "step-num" }, "✓"),
      h("div", { class: "step-body" }, h("b", null, `Listo en ${msText(total)}`),
        h("div", { class: "muted small" }, "A partir de aquí, cada mensaje se convierte en rasgos igual que las frases y el modelo puntúa cada intención. Mira abajo cómo lo hace con una frase concreta."))));
  }

  function lossText(r) {
    const hist = r.history || [];
    if (hist.length < 2) return "Con una sola intención no hay nada que distinguir: no hace falta entrenar pesos.";
    const first = hist[0], last = hist[hist.length - 1];
    return `Al empezar todos los pesos valen 0 y no sabe nada (error ${format.nf(2).format(first.loss)}, acierta el ${pctf(first.accuracy)} por casualidad). ` +
      `Al terminar, el error es ${format.nf(2).format(last.loss)} y acierta el ${pctf(last.accuracy)} de sus propias frases. ` +
      "Ojo: acertar las frases que ya conoce es fácil; el examen de abajo mide frases nuevas.";
  }

  function learningCurves(r) {
    const hist = r.history || [];
    if (hist.length < 2) return null;
    const loss = lineChart({ data: hist.map((p) => ({ x: p.epoch, y: p.loss })), xLabel: "época", label: "Error por época",
      yFormat: (v) => format.nf(2).format(v) });
    const acc = lineChart({ data: hist.map((p) => ({ x: p.epoch, y: p.accuracy })), yMax: 1, xLabel: "época", label: "Aciertos por época",
      yFormat: (v) => format.nf(0).format(v * 100) + " %" });
    curves = [loss, acc];
    return h("div", null, h("div", { class: "grid-2" },
      h("div", null, h("div", { class: "chart-title" }, "Error (cuanto más bajo, mejor)"), loss),
      h("div", null, h("div", { class: "chart-title" }, "Aciertos con sus propias frases"), acc)),
    h("div", { class: "faint small", style: { marginTop: "6px" } }, "Eje horizontal: número de época (0 = antes de aprender). Pasa el ratón por las curvas para ver cada valor."));
  }

  async function trainAnimated() {
    trainBtn.disabled = true;
    try {
      await busy(trainBtn, async () => {
        await api.train(agentId);
        model = await api.model(agentId, { chars: includeChars });
      });
      trainBtn.disabled = true;
      drawStats();
      await drawSteps();
      drawLearned();
      drawMap();
      if (destroyed) return;
      stepNodes.forEach((n) => { n.classList.remove("done"); n.classList.add("pending"); });
      const final = stepsBox.querySelector(".final");
      final.classList.remove("done");
      final.classList.add("pending");
      stepsCard.scrollIntoView({ behavior: "smooth", block: "start" });
      for (let i = 0; i < stepNodes.length; i++) {
        if (destroyed) return;
        const n = stepNodes[i];
        n.classList.remove("pending");
        n.classList.add("active");
        if (i === 4 && curves.length) {
          const len = (model.report.history || []).length;
          curves.forEach((c) => c.setProgress(1));
          for (let k = 1; k <= len; k++) {
            curves.forEach((c) => c.setProgress(k));
            await sleep(140);
          }
        } else {
          await sleep(900);
        }
        n.classList.remove("active");
        n.classList.add("done");
      }
      final.classList.remove("pending");
      final.classList.add("done");
      toast("Modelo reentrenado", "success");
    } catch (e) {
      errorToast(e);
    } finally {
      trainBtn.disabled = false;
    }
  }

  // ------------------------------------------------------ una frase por dentro
  const explainInput = h("input", { type: "text", class: "grow", "aria-label": "Frase para explicar",
    placeholder: "Escribe cualquier frase…", value: (query && query.get("q")) || model.report.example || "" });
  const explainBtn = h("button", { class: "btn primary", type: "button", onclick: () => runExplain() }, icon("sparkle"), "Explicar");
  const explainBox = h("div");
  explainInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runExplain(); } });
  page.append(h("div", { class: "card" },
    h("div", { class: "card-head" }, icon("eye"), h("h2", null, "Sigue una frase por dentro"),
      h("span", { class: "help" }, "Escribe cualquier frase y mira cada paso hasta la decisión.")),
    h("div", { class: "card-body col", style: { gap: "12px" } },
      h("div", { class: "analyze-box" }, icon("search"), explainInput, explainBtn),
      explainBox)));

  async function runExplain() {
    const text = explainInput.value.trim();
    if (!text) return;
    try {
      explained = await busy(explainBtn, () => api.explain(agentId, text));
    } catch (e) { errorToast(e); return; }
    const winner = explained.ranking[0];
    if (winner && !winner.isFallback) mapA = winner.id;
    drawExplain();
    drawMap();
  }

  function drawExplain() {
    clear(explainBox);
    const ex = explained;
    if (!ex) return;
    const winner = ex.ranking[0];
    const contrib = ex.contributions[0];
    const card = (n, title, ...body) => h("div", { class: "flow-step" },
      h("div", { class: "flow-title" }, h("span", { class: "step-num sm" }, String(n)), title), ...body);
    const tokens = ex.tokens.filter((t) => t.kind !== "symbol");
    const ranking = barList({
      items: ex.ranking.slice(0, 5).map((r) => ({ label: r.name, value: r.prob,
        tip: `probabilidad · confianza ${pctf(r.confidence)}${r.match === "exact" ? " · coincidencia exacta" : ""}` })),
      max: 1, format: (v) => pctf(v), labelWidth: 150,
    });
    const why = contrib ? divergingBars({
      items: [...contrib.positive, ...contrib.negative].map((p) => ({ label: p.label, sub: KIND_SHORT[p.kind], value: p.contribution,
        tip: `${p.kindLabel}: peso TF-IDF × peso aprendido` })),
    }) : h("div", { class: "muted small" }, "Sin contribuciones (frase vacía o desconocida).");
    explainBox.append(h("div", { class: "flow" },
      card(1, "Tokens: original, normalizado y raíz", tokenTable(tokens),
        tokens.some((t) => t.corrected) ? h("div", { class: "muted small" }, "Las flechas → son correcciones ortográficas contra el vocabulario del agente.") : null),
      card(2, "Entidades encontradas", placeholderView(ex),
        ex.entities.length ? null : h("div", { class: "muted small" }, "No ha encontrado entidades.")),
      card(3, "Rasgos con más peso (TF-IDF)", barList({
        items: ex.features.slice(0, 10).map((f) => ({ label: f.label, sub: KIND_SHORT[f.kind], value: f.weight, tip: `${f.kindLabel}${f.detail ? " · " + f.detail : ""}` })),
        format: (v) => format.nf(3).format(v), labelWidth: 170 }),
        ex.featureCounts.unknown ? h("div", { class: "muted small" }, `${ex.featureCounts.unknown} rasgos no aparecen en ninguna frase de entrenamiento y se ignoran.`) : null),
      card(4, "Probabilidad de cada intención", ranking,
        h("div", { class: "muted small" }, "Para cada intención suma «peso TF-IDF × peso aprendido» de cada rasgo y convierte las sumas en probabilidades (softmax).")),
      card(5, contrib ? `Por qué gana «${contrib.name}»` : "Por qué gana", why,
        contrib ? h("div", { class: "muted small" }, `Suma total: ${format.nf(2).format(contrib.score)} (incluye un punto de partida de ${format.nf(2).format(contrib.bias)} propio de la intención).`) : null),
      card(6, "Decisión", winner ? meter({ value: winner.confidence, threshold: ex.threshold }) : h("div", null, "Ninguna intención."),
        ex.template ? h("div", { class: "notice success" }, icon("check"), "Coincide exactamente con una frase de entrenamiento: confianza 100 %.") : null,
        h("div", { class: "muted small" }, "La confianza combina la probabilidad con el parecido real con las frases de entrenamiento:"),
        h("ul", { class: "neighbors" }, ex.neighbors.slice(0, 4).map((n) => h("li", null, "“", n.text, "” ",
          h("span", { class: "faint" }, `${n.intentName} · ${pctf(n.similarity)}`)))))));
    explainBox.append(h("div", { class: "muted small", style: { marginTop: "10px" } }, "En el mapa de frases de abajo aparece marcada como «tu frase»."));
  }

  // ------------------------------------------------- lo que ha aprendido
  const learnedBox = h("div");
  const charsToggle = h("label", { class: "check small" }, h("input", { type: "checkbox", onchange: async (e) => {
    includeChars = e.target.checked;
    try { model = await api.model(agentId, { chars: includeChars }); drawLearned(); } catch (err) { errorToast(err); }
  } }), "Incluir trozos de letras");
  page.append(h("div", { class: "card" },
    h("div", { class: "card-head" }, icon("cpu"), h("h2", null, "Lo que ha aprendido cada intención"), h("span", { class: "spacer" }), charsToggle),
    h("div", { class: "card-body" },
      h("p", { class: "muted small", style: { margin: "0 0 12px" } }, "Los rasgos con más peso a favor de cada intención: cuanto más larga la barra, más empuja una frase hacia ella. Si ves palabras poco útiles (como «lo» o «con»), añade frases más variadas."),
      learnedBox)));

  function drawLearned() {
    clear(learnedBox);
    const items = model.topFeatures.filter((i) => i.features.length);
    if (!items.length) { learnedBox.append(h("div", { class: "notice" }, icon("info"), "Hacen falta al menos dos intenciones con frases para que haya algo que aprender.")); return; }
    learnedBox.append(h("div", { class: "multiples" }, items.map((it) => h("div", { class: "multiple" },
      h("div", { class: "row" }, h("a", { href: agentPath("intents/" + encodeURIComponent(it.id)), class: "multiple-title" }, it.name),
        h("span", { class: "spacer" }), h("span", { class: "faint small" }, it.isFallback ? "negativos" : `${it.phrases} frases`)),
      barList({ items: it.features.slice(0, 6).map((f) => ({ label: f.label, sub: KIND_SHORT[f.kind], value: f.weight,
        tip: `${f.kindLabel}${f.detail ? " · " + f.detail : ""}` })), format: (v) => format.nf(2).format(v), labelWidth: 130 })))));
  }

  // ------------------------------------------------------------- mapa
  const mapBox = h("div");
  const selA = h("select", { "aria-label": "Intención resaltada en azul" });
  const selB = h("select", { "aria-label": "Intención resaltada en naranja" });
  selA.addEventListener("change", () => { mapA = selA.value || null; drawMap(); });
  selB.addEventListener("change", () => { mapB = selB.value || null; drawMap(); });
  page.append(h("div", { class: "card" },
    h("div", { class: "card-head" }, icon("globe"), h("h2", null, "Mapa de frases")),
    h("div", { class: "card-body col", style: { gap: "12px" } },
      h("p", { class: "muted small", style: { margin: 0 } }, "Cada punto es una frase de entrenamiento, colocada según cómo la puntúa el modelo: las que ve parecidas quedan juntas. Si dos grupos se mezclan, el bot puede confundir esas intenciones. Pasa el ratón por un punto para leer la frase."),
      h("div", { class: "row wrap" },
        h("span", { class: "legend-key a" }), h("label", { class: "small row" }, "Resaltar ", selA),
        h("span", { class: "legend-key b" }), h("label", { class: "small row" }, "y comparar con ", selB)),
      mapBox,
      h("div", { class: "faint small" }, "Técnica: t-SNE sobre las puntuaciones del modelo (una por intención). Las distancias entre grupos lejanos no tienen un significado exacto."))));

  function drawMap() {
    const pts = model.projection.points;
    const intents = state.agent.intents.filter((i) => pts.some((p) => p.intentId === i.id)).sort((x, y) => x.name.localeCompare(y.name));
    if (!mapA && intents.length) {
      const counts = {};
      pts.forEach((p) => { counts[p.intentId] = (counts[p.intentId] || 0) + 1; });
      mapA = intents.reduce((best, i) => (counts[i.id] > (counts[best] || 0) ? i.id : best), intents[0].id);
    }
    const fill = (sel, value, allowEmpty) => {
      clear(sel);
      if (allowEmpty) sel.append(h("option", { value: "" }, "(ninguna)"));
      intents.forEach((i) => sel.append(h("option", { value: i.id, selected: i.id === value }, i.name)));
    };
    fill(selA, mapA, true);
    fill(selB, mapB, true);
    clear(mapBox);
    if (pts.length < 3) { mapBox.append(h("div", { class: "notice" }, icon("info"), "Hacen falta más frases para dibujar el mapa.")); return; }
    mapBox.append(scatter({ points: pts, a: mapA, b: mapB, names: names(), probe: explained && explained.position }));
    if (model.projection.sampled) mapBox.append(h("div", { class: "faint small" }, "Hay muchas frases: se muestra una muestra representativa."));
  }

  // ------------------------------------------------------------- examen
  const examBox = h("div");
  const examBtn = h("button", { class: "btn", type: "button", onclick: () => runExam() }, icon("training"), "Hacer el examen");
  page.append(h("div", { class: "card" },
    h("div", { class: "card-head" }, icon("target"), h("h2", null, "Examen: ¿acierta con frases que no ha visto?"), h("span", { class: "spacer" }), examBtn),
    h("div", { class: "card-body col", style: { gap: "14px" } },
      h("p", { class: "muted small", style: { margin: 0 } }, "Validación cruzada: esconde 1 de cada 5 frases, entrena con el resto y comprueba si acierta las escondidas. Lo repite 5 veces para que todas las frases se examinen una vez. Es la mejor estimación de cómo funcionará con usuarios reales."),
      examBox)));

  async function runExam() {
    clear(examBox).append(h("div", { class: "notice" }, h("span", { class: "spinner" }), "Examinando… (entrena el modelo 5 veces)"));
    try {
      model.evaluation = await busy(examBtn, () => api.evaluate(agentId));
      drawExam();
      drawStats(false);
      if (!mapB && model.evaluation) {
        const row = model.evaluation.perIntent.find((p) => p.id === mapA);
        const other = row && row.confusedWith.find((c) => c.id !== "__fallback__");
        if (other) { mapB = other.id; drawMap(); }
      }
    } catch (e) { errorToast(e); clear(examBox); }
  }

  function drawExam() {
    clear(examBox);
    const ev = model.evaluation;
    if (!ev) return;
    const tiles = h("div", { class: "grid-3" },
      tile("target", "Acierto con frases nuevas", ev.accuracy, pctf, `umbral de confianza ${pctf(ev.threshold)}`),
      tile("list", "Frases examinadas", ev.total, int, `${ev.folds} rondas`),
      tile("alert", "Fallos", ev.total - ev.correct, int, "abajo puedes verlos uno a uno"));
    examBox.append(tiles);
    stagger(tiles);
    examBox.append(dataTable({
      rows: ev.perIntent,
      sort: { col: 2, dir: "asc" },
      columns: [
        { label: "Intención", key: "name", render: (r) => r.id === "__fallback__" ? r.name : h("a", { href: agentPath("intents/" + encodeURIComponent(r.id)) }, r.name) },
        { label: "Frases", key: "phrases", num: true, render: (r) => int(r.phrases) },
        { label: "Acierto", key: "recall", desc: true, width: "240px", render: (r) => r.recall == null ? h("span", { class: "faint" }, "—")
          : h("div", { class: "row", style: { gap: "10px" } },
            h("div", { class: "meter small-meter grow" }, h("div", { class: "meter-fill", style: { width: Math.round(r.recall * 100) + "%" } })),
            h("b", { class: "tnum", style: { minWidth: "40px", textAlign: "right" } }, pctf(r.recall))) },
        { label: "Se confunde con", value: (r) => r.confusedWith.length ? r.confusedWith[0].name : null, className: "cell-muted small",
          render: (r) => r.confusedWith.slice(0, 3).map((c, i) => [i ? ", " : "", `${c.name} (${c.count})`]) },
      ],
    }));
    examBox.append(h("details", null, h("summary", { class: "small", style: { cursor: "pointer", color: "var(--accent-text)", fontWeight: 550 } }, "Ver la matriz de confusión"),
      h("div", { class: "muted small", style: { margin: "8px 0" } }, "Cada fila es la intención real y cada columna lo que entendió. Lo ideal es que todo esté en la diagonal."),
      heatmap({ labels: ev.matrix.labels, counts: ev.matrix.counts })));
    if (ev.errors.length) {
      examBox.append(h("div", { class: "section-title" }, `Frases que ha fallado (${ev.errors.length})`),
        dataTable({
          rows: ev.errors.slice(0, 60), scroll: true,
          columns: [
            { label: "Frase", key: "text", render: (e) => ["“", e.text, "”"] },
            { label: "Era", key: "expectedName", render: (e) => e.expected === "__fallback__" ? e.expectedName : h("a", { href: agentPath("intents/" + encodeURIComponent(e.expected)) }, e.expectedName) },
            { label: "Entendió", key: "predictedName", className: "cell-muted" },
            { label: "Confianza", key: "confidence", num: true, className: "cell-muted", render: (e) => pctf(e.confidence) },
            { label: "", sortable: false, render: (e) => h("button", { class: "btn sm ghost", type: "button", onclick: () => {
              explainInput.value = e.text;
              runExplain();
              explainInput.scrollIntoView({ behavior: "smooth", block: "center" });
            } }, icon("eye"), "Explicar") },
          ],
        }),
        h("div", { class: "notice info" }, icon("sparkle"), "Consejo: si una intención falla mucho, añade frases más variadas. Si dos se confunden, revisa que sus frases no se parezcan demasiado o usa contextos."));
    }
  }

  drawStats();
  await drawSteps();
  drawLearned();
  drawMap();
  drawExam();
  if (query && query.get("q")) runExplain();
  return { destroy: () => { destroyed = true; } };
}

// ------------------------------------------------------------ auxiliares
function tokenTable(tokens) {
  return h("div", { class: "token-grid" }, tokens.map((t) => h("div", { class: "token" + (t.stop ? " stop" : "") },
    h("span", { class: "t" }, t.text),
    t.norm !== t.text ? h("span", { class: "n" }, t.norm) : null,
    t.kind === "word" && t.stem !== t.norm ? h("span", { class: "s" }, "√ " + t.stem) : null,
    t.corrected ? h("span", { class: "corr" }, "→ " + t.corrected) : null)));
}

function placeholderView(ex) {
  const text = ex.text;
  const parts = [];
  const seq = [];
  let pos = 0;
  ex.entities.forEach((e, i) => {
    if (e.start > pos) parts.push(text.slice(pos, e.start));
    parts.push(h("span", { class: "ann ann-" + (i % 8), title: `${e.entity} = ${typeof e.value === "object" ? JSON.stringify(e.value) : e.value}` }, text.slice(e.start, e.end)));
    pos = e.end;
  });
  parts.push(text.slice(pos));
  let p2 = 0;
  ex.entities.forEach((e) => {
    if (e.start > p2) seq.push(text.slice(p2, e.start));
    seq.push(h("code", { class: "placeholder" }, e.entity));
    p2 = e.end;
  });
  seq.push(text.slice(p2));
  return h("div", { class: "col", style: { gap: "4px" } },
    h("div", { class: "result-text", style: { fontSize: "15px", lineHeight: "1.9" } }, parts),
    ex.entities.length ? h("div", { class: "small muted" }, "→ el modelo ve: ", h("span", null, seq)) : null);
}
