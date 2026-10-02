// Analizador: cómo entiende el agente una frase (tokens, entidades, intención)
// y corrección inmediata ("lo ha entendido bien / mal").
import { api } from "../api.js";
import { h, icon, clear, chipsInput, toast, errorToast, formatValue, pct, confBar, pageHead, dataTable, busy, tokenGloss,
  selectMenu } from "../ui.js";
import { annotatedPhrase, colorMap, suggestParam } from "../annotate.js";
import { agentPath, reloadAgent, state } from "../app.js";

const SOURCE_LABEL = {
  sys: "sistema", dict: "valor exacto", stem: "por raíz (plural/género)", fuzzy: "con falta corregida", regex: "regex",
};
export async function render(el, _params, query) {
  let contexts = [];
  const input = h("input", { type: "text", class: "big grow", style: { fontWeight: 500 }, placeholder: "Escribe una frase como la diría un usuario…",
    "aria-label": "Frase a analizar", value: (query && query.get("q")) || "" });
  const runBtn = h("button", { class: "btn primary", type: "button", onclick: () => run() }, icon("sparkle"), "Analizar");
  const results = h("div");
  const run = async () => {
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    try {
      const a = await busy(runBtn, () => api.analyze(state.agent.id, text, contexts));
      drawResults(text, a);
      history.replaceState(null, "", agentPath("analyzer") + "?q=" + encodeURIComponent(text));
    } catch (e) {
      clear(results);
      errorToast(e);
    }
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); run(); } });
  const ctxChips = chipsInput({ values: [], placeholder: "contextos activos (opcional)",
    transform: (v) => v.toLowerCase().replace(/\s+/g, "-"), onChange: (v) => { contexts = v; } });

  el.append(h("div", { class: "page" },
    pageHead({ icon: "text", title: "Analizador de frases", sub: "Mira paso a paso cómo tokeniza y entiende una frase, y corrígelo si se equivoca." }),
    h("div", { class: "card" }, h("div", { class: "card-body col", style: { paddingTop: "16px", gap: "12px" } },
      h("div", { class: "analyze-box" }, icon("search"), input, runBtn),
      h("div", { class: "row" }, h("span", { class: "muted small nowrap" }, "Simular contextos:"), h("div", { class: "grow" }, ctxChips)))),
    results));
  if (input.value) run();
  else input.focus();

  // ------------------------------------------------------------------
  function drawResults(text, a) {
    clear(results);
    const colorOf = colorMap([]);
    const entColor = (e) => colorOf(e.entity, e.entity);
    const best = a.ranking[0];
    const intent = best && state.agent.intents.find((i) => i.id === best.id);

    // Texto resaltado + decisión
    const hl = h("div", { class: "result-text" });
    let pos = 0;
    for (const e of a.entities) {
      if (e.start > pos) hl.append(text.slice(pos, e.start));
      hl.append(h("span", { class: "ann ann-" + entColor(e), title: `${e.entity} = ${formatValue(e.value)}` }, text.slice(e.start, e.end)));
      pos = e.end;
    }
    hl.append(text.slice(pos));
    const decision = a.accepted
      ? h("div", { class: "notice success" }, icon("check"),
        h("div", null, "Intención ", h("b", null, best.name), ` con confianza ${pct(best.confidence)}`,
          best.match === "exact" ? " (coincide exactamente con una frase de entrenamiento)" : "", "."))
      : h("div", { class: "notice warning" }, icon("alert"),
        h("div", null, best && !best.isFallback
          ? ["No llega al umbral: la mejor opción es ", h("b", null, best.name), ` con ${pct(best.confidence)} (umbral ${pct(a.threshold)}). Respondería el fallback.`]
          : "No la entiende: respondería la intención de fallback."));
    const params = Object.entries(a.parameters || {});
    results.append(h("div", { class: "card", style: { marginTop: "16px" } },
      h("div", { class: "card-head" }, icon("target"), h("h2", null, "Resultado"), h("span", { class: "spacer" }),
        h("span", { class: "badge", title: "Tiempo de análisis" }, icon("clock"), `${a.ms} ms`)),
      h("div", { class: "card-body col", style: { gap: "12px" } }, hl, decision,
        params.length ? h("div", { class: "kv-table" }, params.map(([k, v]) => [h("div", null, h("code", null, "$" + k)),
          h("div", null, formatValue(v), a.parametersOriginal && a.parametersOriginal[k] != null && formatValue(a.parametersOriginal[k]) !== formatValue(v)
            ? h("span", { class: "faint" }, ` («${formatValue(a.parametersOriginal[k])}»)`) : null)])) : null)));

    results.append(feedbackCard(text, a, intent));
    results.append(tokensCard(text, a, entColor));
    results.append(entitiesCard(a));
    results.append(rankingCard(a));
    if (a.neighbors && a.neighbors.length) results.append(neighborsCard(a));
  }

  // ------------------------------------------------------- tokenización
  function tokensCard(text, a, entColor) {
    const grid = tokenGloss(a.tokens, { entities: a.entities, entColor });
    // regla de normalización
    const word = h("input", { type: "text", placeholder: "palabra (p. ej. «pizzeta»)", "aria-label": "Palabra", style: { width: "180px" } });
    const repl = h("input", { type: "text", placeholder: "se entiende como (p. ej. «pizza»)", "aria-label": "Reemplazo", style: { width: "220px" } });
    const addRule = async () => {
      const w = word.value.trim().toLowerCase(), r = repl.value.trim();
      if (!w) { word.focus(); return; }
      try {
        const norm = { ...(state.agent.settings.normalization || {}), [w]: r };
        state.agent = await api.updateAgent(state.agent.id, { settings: { normalization: norm } });
        toast(`Regla guardada: «${w}» → «${r || "(se ignora)"}»`, "success");
        word.value = ""; repl.value = "";
        run();
      } catch (e) { errorToast(e); }
    };
    return h("div", { class: "card" },
      h("div", { class: "card-head" }, icon("hash"), h("h2", null, "Tokenización"),
        h("span", { class: "help" }, "Cada palabra en una columna y cada paso en una fila: lo que cambia se resalta")),
      h("div", { class: "card-body col", style: { gap: "12px" } }, grid,
        h("details", null,
          h("summary", { class: "small", style: { cursor: "pointer", color: "var(--accent-text)", fontWeight: 550 } }, "¿Ha tokenizado algo mal? Enséñale cómo debe leer una palabra"),
          h("div", { class: "col", style: { marginTop: "10px" } },
            h("div", { class: "muted small" }, "Las reglas se aplican antes de todo lo demás (abreviaturas, jerga, errores frecuentes). Deja el segundo campo vacío para ignorar la palabra."),
            h("div", { class: "row wrap" }, word, icon("arrowRight"), repl, h("button", { class: "btn sm", type: "button", onclick: addRule }, icon("plus"), "Añadir regla")),
            Object.keys(state.agent.settings.normalization || {}).length
              ? h("div", { class: "small muted" }, "Reglas actuales: ", Object.entries(state.agent.settings.normalization).map(([k, v], i) => [i ? " · " : "", h("code", null, `${k} → ${v || "∅"}`)]),
                " ", h("a", { href: agentPath("settings") }, "(editar en Ajustes)"))
              : null))));
  }

  function entityColumns() {
    return [
      { label: "Entidad", key: "entity", render: (e) => h("code", null, e.entity) },
      { label: "Texto", key: "text", render: (e) => "«" + e.text + "»" },
      { label: "Valor", value: (e) => formatValue(e.value), render: (e) => h("code", null, formatValue(e.value)) },
      { label: "Cómo", value: (e) => SOURCE_LABEL[e.source] || e.source, className: "cell-muted" },
      { label: "Seguridad", key: "score", num: true, render: (e) => pct(e.score) },
    ];
  }

  function entitiesCard(a) {
    return h("div", { class: "card" },
      h("div", { class: "card-head" }, icon("tag"), h("h2", null, "Entidades"), h("span", { class: "badge" }, String(a.entities.length))),
      h("div", { class: "card-body" },
        a.entities.length ? dataTable({ columns: entityColumns(), rows: a.entities })
          : h("div", { class: "notice" }, icon("info"), "No ha encontrado entidades."),
        a.candidates && a.candidates.length ? h("details", { style: { marginTop: "10px" } },
          h("summary", { class: "small muted", style: { cursor: "pointer" } }, `Otros candidatos descartados por solaparse o ser dudosos (${a.candidates.length})`),
          h("div", { style: { marginTop: "8px" } }, dataTable({ columns: entityColumns(), rows: a.candidates }))) : null));
  }

  function rankingCard(a) {
    return h("div", { class: "card" },
      h("div", { class: "card-head" }, icon("gauge"), h("h2", null, "Intenciones candidatas"),
        h("span", { class: "help" }, "Confianza = probabilidad del modelo ajustada por el parecido con las frases. La línea roja es el umbral.")),
      h("div", { class: "card-body" }, dataTable({
        rows: a.ranking,
        columns: [
          { label: "Intención", key: "name", render: (r) => [h("a", { href: agentPath("intents/" + encodeURIComponent(r.id)) }, r.name),
            r.isFallback ? h("span", { class: "badge warning", style: { marginLeft: "6px" } }, "fallback") : null] },
          { label: "Confianza", key: "confidence", desc: true, width: "230px", render: (r) => h("div", { class: "row", style: { gap: "10px" } },
            h("div", { class: "grow" }, confBar(r.confidence, a.threshold)), h("b", { class: "tnum", style: { minWidth: "38px" } }, pct(r.confidence))) },
          { label: "Probabilidad", key: "prob", num: true, className: "cell-muted", render: (r) => pct(r.prob) },
          { label: "Parecido", key: "sim", num: true, className: "cell-muted", render: (r) => pct(r.sim) },
          { label: "", sortable: false, render: (r) => r.match === "exact" ? h("span", { class: "badge success" }, "exacta")
            : r.contextual ? h("span", { class: "badge primary" }, "contexto") : null },
        ],
      })));
  }

  function neighborsCard(a) {
    return h("div", { class: "card" },
      h("div", { class: "card-head" }, icon("list"), h("h2", null, "Frases de entrenamiento más parecidas")),
      h("div", { class: "card-body" }, dataTable({
        rows: a.neighbors,
        columns: [
          { label: "Frase", key: "text", render: (n) => ["“", n.text, "”"] },
          { label: "Intención", key: "intentName", render: (n) => h("a", { href: agentPath("intents/" + encodeURIComponent(n.intentId)) }, n.intentName) },
          { label: "Parecido", key: "similarity", num: true, render: (n) => pct(n.similarity) },
        ],
      })));
  }

  // ------------------------------------------------------------ feedback
  function feedbackCard(text, a, detected) {
    const box = h("div", { class: "card-body col" });
    const card = h("div", { class: "card highlight" },
      h("div", { class: "card-head" }, icon("sparkle"), h("h2", null, "¿Lo ha entendido bien?")), box);
    const yes = h("button", { class: "btn ok", type: "button" }, icon("thumbUp"), "Sí, es correcto");
    const no = h("button", { class: "btn", type: "button" }, icon("thumbDown"), "No, corregir");
    const editor = h("div", { class: "col hidden", style: { gap: "12px", marginTop: "4px" } });
    box.append(h("div", { class: "row wrap" }, yes, no,
      h("span", { class: "muted small" }, "Al confirmar o corregir, la frase se guarda como ejemplo y el bot aprende al momento.")), editor);

    yes.addEventListener("click", async () => {
      const target = a.accepted && detected ? detected : state.agent.intents.find((i) => i.isFallback);
      if (!target) { toast("No hay intención a la que añadirla", "error"); return; }
      const anns = target.isFallback ? [] : defaultAnnotations(a, target);
      await addPhrase(target, anns, box);
    });
    no.addEventListener("click", () => {
      editor.classList.toggle("hidden");
      if (!editor.childElementCount) buildEditor();
    });

    function buildEditor() {
      let selected = detected && !detected.isFallback ? detected : state.agent.intents.find((i) => !i.isFallback);
      const select = selectMenu({ label: "Intención correcta", value: selected ? selected.id : null, groups: [
        { title: "Intenciones", options: state.agent.intents.filter((i) => !i.isFallback).sort((x, y) => x.name.localeCompare(y.name))
          .map((i) => ({ value: i.id, label: i.name })) },
        { title: "No debería entenderla", options: state.agent.intents.filter((i) => i.isFallback).map((i) => ({ value: i.id, label: i.name + " (fallback)" })) },
      ] });
      const phraseBox = h("div", { class: "phrase-list", style: { marginTop: 0 } });
      const synBox = h("div", { class: "col" });
      let annotations = [];
      const drawPhrase = () => {
        clear(phraseBox);
        const params = selected ? selected.parameters : [];
        const row = h("div", { class: "phrase-row" }, h("span", { class: "quote" }, "“"), annotatedPhrase({
          text, annotations,
          getParams: () => params,
          getEntities: () => state.agent.entities,
          systemEntities: state.info.systemEntities,
          colorOf: colorMap(params),
          onChange: (anns) => { annotations = anns; drawSynonyms(); },
        }));
        phraseBox.append(row);
        drawSynonyms();
      };
      const drawSynonyms = () => {
        clear(synBox);
        for (const an of annotations) {
          const ent = state.agent.entities.find((e) => "@" + e.name === an.entity);
          if (!ent || ent.kind === "regex") continue;
          const span = text.slice(an.start, an.end);
          const known = a.entities.some((e) => e.entity === an.entity && e.start === an.start && e.end === an.end && e.source !== "fuzzy");
          if (known) continue;
          const detectedValue = (a.entities.find((e) => e.entity === an.entity && e.start === an.start && e.end === an.end) || {}).value;
          const values = ent.entries.map((en) => ({ value: en.value, label: en.value }));
          const sel = selectMenu({ label: "Valor", className: "w-200",
            value: values.some((v) => v.value === detectedValue) ? detectedValue : values.length ? values[0].value : "__new",
            options: [...values, { value: "__new", label: "(nuevo valor: " + span + ")" }] });
          synBox.append(h("div", { class: "notice info" }, icon("tag"), h("div", { class: "row wrap grow" },
            h("span", null, "«", h("b", null, span), "» no es un sinónimo de ", h("code", null, an.entity), ". Añadirlo como:"), sel,
            h("button", { class: "btn sm", type: "button", onclick: async (ev) => {
              try {
                const value = sel.value === "__new" ? span : sel.value;
                await api.addSynonym(state.agent.id, ent.id, value, span);
                await reloadAgent();
                ev.target.closest(".notice").replaceWith(h("div", { class: "notice success" }, icon("check"), `Añadido «${span}» a @${ent.name}`));
              } catch (e) { errorToast(e); }
            } }, "Añadir sinónimo"))));
        }
      };
      select.addEventListener("change", () => {
        selected = state.agent.intents.find((i) => i.id === select.value);
        annotations = selected && !selected.isFallback ? defaultAnnotations(a, selected) : [];
        drawPhrase();
      });
      annotations = selected && !selected.isFallback ? defaultAnnotations(a, selected) : [];
      drawPhrase();
      const saveBtn = h("button", { class: "btn primary", type: "button", onclick: () => addPhrase(selected, selected.isFallback ? [] : annotations, box) },
        icon("check"), "Guardar como frase de entrenamiento");
      editor.append(
        h("div", { class: "field", style: { maxWidth: "420px" } }, h("span", null, "Intención correcta"), select),
        h("div", { class: "field" }, h("span", null, "Entidades en la frase"),
          h("span", { class: "hint" }, "Selecciona texto para marcar una entidad; pulsa una marca para cambiarla o quitarla."), phraseBox),
        synBox,
        h("div", null, saveBtn));
    }
    return card;
  }

  async function addPhrase(intent, annotations, box) {
    try {
      await api.addPhrase(state.agent.id, intent.id, input.value.trim(), annotations);
      await reloadAgent();
      clear(box).append(h("div", { class: "notice success" }, icon("check"),
        h("div", null, "Guardada en ", h("a", { href: agentPath("intents/" + encodeURIComponent(intent.id)) }, intent.name),
          intent.isFallback ? " como ejemplo negativo." : ".", " El modelo ya se ha actualizado. ",
          h("a", { href: "#", onclick: (e) => { e.preventDefault(); run(); } }, "Volver a analizar"))));
    } catch (e) { errorToast(e); }
  }
}

// Anotaciones propuestas a partir de las entidades detectadas
function defaultAnnotations(a, intent) {
  const used = [];
  return a.entities.map((e) => {
    const param = suggestParam(e.entity, intent.parameters, used);
    used.push(param);
    return { start: e.start, end: e.end, entity: e.entity, param };
  });
}
