// Analizador: cómo entiende el agente una frase (tokens, entidades, intención)
// y corrección inmediata ("lo ha entendido bien / mal").
import { api } from "../api.js";
import { h, icon, clear, chipsInput, toast, errorToast, formatValue, pct, confBar } from "../ui.js";
import { annotatedPhrase, colorMap, suggestParam } from "../annotate.js";
import { agentPath, reloadAgent, state } from "../app.js";

const SOURCE_LABEL = {
  sys: "sistema", dict: "valor exacto", stem: "por raíz (plural/género)", fuzzy: "con falta corregida", regex: "regex",
};
const KIND_LABEL = { word: "palabra", number: "número", time: "hora", date: "fecha", url: "url", email: "email", symbol: "símbolo" };

export async function render(el, _params, query) {
  let contexts = [];
  const input = h("input", { type: "text", class: "big grow", style: { fontWeight: 500 }, placeholder: "Escribe una frase como la diría un usuario…",
    "aria-label": "Frase a analizar", value: (query && query.get("q")) || "" });
  const results = h("div");
  const run = async () => {
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    clear(results).append(h("div", { class: "muted", style: { padding: "12px" } }, "Analizando…"));
    try {
      const a = await api.analyze(state.agent.id, text, contexts);
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
    h("div", { class: "page-head" },
      h("div", { class: "grow" }, h("h1", null, "Analizador de frases"),
        h("div", { class: "sub" }, "Mira paso a paso cómo tokeniza y entiende una frase, y corrígelo si se equivoca."))),
    h("div", { class: "card" }, h("div", { class: "card-body col" },
      h("div", { class: "row" }, input, h("button", { class: "btn primary", type: "button", onclick: run }, icon("text"), "Analizar")),
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
    results.append(h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, "Resultado"), h("span", { class: "spacer" }), h("span", { class: "faint small" }, `${a.ms} ms`)),
      h("div", { class: "card-body col" }, hl, decision,
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
    const entAt = (t) => a.entities.find((e) => t.start >= e.start && t.end <= e.end);
    const grid = h("div", { class: "token-grid" }, a.tokens.map((t) => {
      const e = entAt(t);
      const cls = "token" + (t.kind === "symbol" ? " sym" : "") + (t.stop ? " stop" : "") + (e ? " ent ann-" + entColor(e) : "");
      return h("div", { class: cls, title: `${KIND_LABEL[t.kind] || t.kind}${t.stop ? " · palabra vacía" : ""}${t.expanded ? " · abreviatura expandida" : ""}${e ? " · " + e.entity : ""}` },
        h("span", { class: "t" }, t.text),
        t.kind !== "symbol" && t.norm !== t.text ? h("span", { class: "n" }, t.norm) : null,
        t.kind === "word" && t.stem !== t.norm ? h("span", { class: "s" }, "√ " + t.stem) : null,
        t.corrected ? h("span", { class: "corr" }, "→ " + t.corrected) : null);
    }));
    // regla de normalización
    const word = h("input", { type: "text", placeholder: "palabra (p. ej. «pizzeta»)", "aria-label": "Palabra", style: { width: "170px" } });
    const repl = h("input", { type: "text", placeholder: "se entiende como (p. ej. «pizza»)", "aria-label": "Reemplazo", style: { width: "210px" } });
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
    const corrected = a.tokens.filter((t) => t.corrected);
    return h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, "Tokenización"),
        h("span", { class: "help" }, "Texto original · forma normalizada · √ raíz · → corrección ortográfica")),
      h("div", { class: "card-body col" }, grid,
        corrected.length ? h("div", { class: "muted small" }, "Correcciones: ",
          corrected.map((t, i) => [i ? ", " : "", h("b", null, t.norm), " → ", t.corrected])) : null,
        h("details", null,
          h("summary", { class: "small", style: { cursor: "pointer" } }, "¿Ha tokenizado algo mal? Enséñale cómo debe leer una palabra"),
          h("div", { class: "col", style: { marginTop: "8px" } },
            h("div", { class: "muted small" }, "Las reglas se aplican antes de todo lo demás (abreviaturas, jerga, errores frecuentes). Deja el segundo campo vacío para ignorar la palabra."),
            h("div", { class: "row wrap" }, word, h("span", null, "→"), repl, h("button", { class: "btn sm", type: "button", onclick: addRule }, icon("plus"), "Añadir regla")),
            Object.keys(state.agent.settings.normalization || {}).length
              ? h("div", { class: "small muted" }, "Reglas actuales: ", Object.entries(state.agent.settings.normalization).map(([k, v], i) => [i ? " · " : "", h("code", null, `${k} → ${v || "∅"}`)]),
                " ", h("a", { href: agentPath("settings") }, "(editar en Ajustes)"))
              : null))));
  }

  function entitiesCard(a) {
    const row = (e) => h("tr", null, h("td", null, h("code", null, e.entity)), h("td", null, "«" + e.text + "»"),
      h("td", null, h("code", null, formatValue(e.value))), h("td", { class: "muted" }, SOURCE_LABEL[e.source] || e.source),
      h("td", { class: "muted" }, pct(e.score)));
    const head = h("thead", null, h("tr", null, ["Entidad", "Texto", "Valor", "Cómo", "Seguridad"].map((t) => h("th", null, t))));
    return h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, "Entidades"), h("span", { class: "badge" }, String(a.entities.length))),
      h("div", { class: "card-body" },
        a.entities.length ? h("div", { class: "table-wrap" }, h("table", { class: "table" }, head, h("tbody", null, a.entities.map(row))))
          : h("div", { class: "muted small" }, "No ha encontrado entidades."),
        a.candidates && a.candidates.length ? h("details", { style: { marginTop: "8px" } },
          h("summary", { class: "small muted", style: { cursor: "pointer" } }, `Otros candidatos descartados por solaparse o ser dudosos (${a.candidates.length})`),
          h("div", { class: "table-wrap" }, h("table", { class: "table" }, head, h("tbody", null, a.candidates.map(row))))) : null));
  }

  function rankingCard(a) {
    return h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, "Intenciones candidatas"),
        h("span", { class: "help" }, "Confianza = probabilidad del modelo ajustada por el parecido con las frases. La línea roja es el umbral.")),
      h("div", { class: "card-body" }, h("div", { class: "table-wrap" }, h("table", { class: "table" },
        h("thead", null, h("tr", null, ["Intención", "Confianza", "", "Probabilidad", "Parecido", ""].map((t) => h("th", null, t)))),
        h("tbody", null, a.ranking.map((r) => h("tr", null,
          h("td", null, h("a", { href: agentPath("intents/" + encodeURIComponent(r.id)) }, r.name), r.isFallback ? h("span", { class: "badge warning", style: { marginLeft: "6px" } }, "fallback") : null),
          h("td", { style: { width: "160px" } }, confBar(r.confidence, a.threshold)),
          h("td", { class: "nowrap" }, pct(r.confidence)),
          h("td", { class: "muted" }, pct(r.prob)),
          h("td", { class: "muted" }, pct(r.sim)),
          h("td", null, r.match === "exact" ? h("span", { class: "badge success" }, "exacta") : r.contextual ? h("span", { class: "badge primary" }, "contexto") : null))))))));
  }

  function neighborsCard(a) {
    return h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, "Frases de entrenamiento más parecidas")),
      h("div", { class: "card-body" }, h("div", { class: "table-wrap" }, h("table", { class: "table" },
        h("tbody", null, a.neighbors.map((n) => h("tr", null,
          h("td", null, "“", n.text, "”"),
          h("td", null, h("a", { href: agentPath("intents/" + encodeURIComponent(n.intentId)) }, n.intentName)),
          h("td", { class: "muted nowrap" }, pct(n.similarity)))))))));
  }

  // ------------------------------------------------------------ feedback
  function feedbackCard(text, a, detected) {
    const box = h("div", { class: "card-body col" });
    const card = h("div", { class: "card", style: { borderColor: "var(--primary)" } },
      h("div", { class: "card-head" }, h("h2", null, "¿Lo ha entendido bien?")), box);
    const yes = h("button", { class: "btn ok", type: "button" }, icon("thumbUp"), "Sí, es correcto");
    const no = h("button", { class: "btn", type: "button" }, icon("thumbDown"), "No, corregir");
    const editor = h("div", { class: "col hidden" });
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
      const select = h("select", { "aria-label": "Intención correcta" },
        h("optgroup", { label: "Intenciones" }, state.agent.intents.filter((i) => !i.isFallback).sort((x, y) => x.name.localeCompare(y.name))
          .map((i) => h("option", { value: i.id, selected: selected && i.id === selected.id }, i.name))),
        h("optgroup", { label: "No debería entenderla" }, state.agent.intents.filter((i) => i.isFallback).map((i) => h("option", { value: i.id }, i.name + " (fallback)"))));
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
          const sel = h("select", { "aria-label": "Valor" }, ent.entries.map((en) => h("option", { value: en.value, selected: en.value === detectedValue }, en.value)),
            h("option", { value: "__new" }, "(nuevo valor: " + span + ")"));
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
        h("label", { class: "field" }, "Intención correcta", select),
        h("div", { class: "field" }, h("span", { style: { fontWeight: 550, fontSize: "13px" } }, "Entidades en la frase"),
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
