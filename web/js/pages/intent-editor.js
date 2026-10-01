// Editor de una intención.
import { api } from "../api.js";
import {
  h, icon, clear, chipsInput, toast, errorToast, confirmDialog, modal, popover, closePopover,
  optionList, switchInput,
} from "../ui.js";
import { annotatedPhrase, colorMap, entityGroups } from "../annotate.js";
import { agentPath, navigate, replaceInAgent, state } from "../app.js";

const uid = (p) => p + Math.random().toString(16).slice(2, 12);
const clone = (x) => JSON.parse(JSON.stringify(x));
const normKey = (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[¿?¡!.,;:\s]+/g, " ").trim();

function snapshot(it) {
  return JSON.stringify({
    ...it,
    trainingPhrases: it.trainingPhrases.map((p) => ({ text: p.text, annotations: p.annotations || [] })),
    parameters: it.parameters.map((p) => ({ ...p, id: undefined })),
    responses: it.responses.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("_")))),
  });
}

export async function render(el, [, intentId]) {
  const agent = state.agent;
  const found = agent.intents.find((i) => i.id === intentId);
  if (!found) {
    el.append(h("div", { class: "page" }, h("div", { class: "notice warning" }, icon("alert"), "Esa intención no existe (quizá se borró)."),
      h("p", null, h("a", { href: agentPath("intents") }, "← Volver a las intenciones"))));
    return null;
  }
  let intent = clone(found);
  let saved = snapshot(intent);
  let saving = false;
  const page = h("div", { class: "page" });
  el.append(page);

  const saveBtn = h("button", { class: "btn primary", type: "button", onclick: () => save() }, icon("check"), "Guardar");
  const dirty = () => snapshot(intent) !== saved;
  const touch = () => { saveBtn.disabled = !dirty() || saving; };

  async function save() {
    if (saving || !dirty()) return;
    if (!intent.name.trim()) { toast("Pon un nombre a la intención", "error"); return; }
    for (const r of intent.responses) {
      if (r.type === "payload" && r._invalid) { toast("El payload no es JSON válido", "error"); return; }
    }
    saving = true;
    touch();
    try {
      const body = clone(intent);
      body.responses = body.responses.map((r) => { const c = { ...r }; delete c._invalid; delete c._raw; return c; })
        .filter((r) => (r.type === "text" && r.variants.some((v) => v.trim())) || (r.type === "quickReplies" && r.items.length) || r.type === "payload");
      const res = await api.updateIntent(agent.id, intent.id, body);
      replaceInAgent("intents", res);
      intent = clone(res);
      saved = snapshot(intent);
      toast("Guardado. El modelo se reentrena solo.", "success");
      const top = el.closest(".main").scrollTop;
      draw();
      el.closest(".main").scrollTop = top;
    } catch (e) {
      errorToast(e);
    } finally {
      saving = false;
      touch();
    }
  }

  async function remove() {
    if (!await confirmDialog(`Se borrará «${intent.name}» con sus ${intent.trainingPhrases.length} frases.`,
      { title: "Borrar intención", okLabel: "Borrar", danger: true })) return;
    try {
      await api.deleteIntent(agent.id, intent.id);
      replaceInAgent("intents", null, intent.id);
      saved = snapshot(intent); // permitir salir
      toast("Intención borrada", "success");
      navigate(agentPath("intents"));
    } catch (e) { errorToast(e); }
  }

  // ------------------------------------------------------------- secciones
  function headSection() {
    const name = h("input", { type: "text", class: "big plain grow", value: intent.name, "aria-label": "Nombre de la intención",
      oninput: () => { intent.name = name.value; touch(); } });
    return h("div", { class: "page-head" },
      h("a", { class: "btn ghost icon-only", href: agentPath("intents"), title: "Volver", "aria-label": "Volver a la lista" }, icon("back")),
      name,
      h("button", { class: "btn ghost icon-only", type: "button", title: "Borrar intención", "aria-label": "Borrar intención", onclick: remove }, icon("trash")),
      saveBtn);
  }

  function contextsSection() {
    const inChips = chipsInput({
      values: intent.inputContexts, placeholder: "Añadir contexto de entrada",
      transform: (v) => v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9_.-]+/g, "-"),
      list: knownContexts(),
      onChange: (v) => { intent.inputContexts = v; touch(); },
    });
    const outBox = h("div", { class: "chips" });
    const outInput = h("input", { type: "text", placeholder: "Añadir contexto de salida", list: "ctx-known" });
    const drawOut = () => {
      clear(outBox);
      intent.outputContexts.forEach((c, i) => {
        const life = h("input", { type: "number", class: "lifespan", min: "0", max: "100", value: String(c.lifespan),
          title: "Duración en turnos (0 = borrar el contexto)", "aria-label": "Duración de " + c.name,
          oninput: () => { c.lifespan = Math.max(0, parseInt(life.value || "0", 10) || 0); touch(); } });
        outBox.append(h("span", { class: "chip", title: "Duración en turnos" }, h("span", null, c.name), life,
          h("button", { type: "button", "aria-label": "Quitar " + c.name, onclick: () => { intent.outputContexts.splice(i, 1); drawOut(); touch(); } }, icon("x"))));
      });
      outBox.append(outInput, h("datalist", { id: "ctx-known" }, knownContexts().map((v) => h("option", { value: v }))));
    };
    const addOut = () => {
      const v = outInput.value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9_.-]+/g, "-");
      outInput.value = "";
      if (v && !intent.outputContexts.some((c) => c.name === v)) {
        intent.outputContexts.push({ name: v, lifespan: agent.settings.defaultLifespan || 5 });
        drawOut(); touch(); outInput.focus();
      }
    };
    outInput.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addOut(); } });
    outInput.addEventListener("blur", () => { if (outInput.value.trim()) addOut(); });
    outBox.addEventListener("click", (e) => { if (e.target === outBox) outInput.focus(); });
    drawOut();
    return h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, "Contextos"),
        h("span", { class: "help" }, "Controlan el flujo: la intención solo se activa si sus contextos de entrada están activos.")),
      h("div", { class: "card-body col" },
        h("div", { class: "grid-2" },
          h("label", { class: "field" }, "Contextos de entrada", inChips, h("span", { class: "hint" }, "Todos deben estar activos.")),
          h("label", { class: "field" }, "Contextos de salida", outBox, h("span", { class: "hint" }, "Se activan al responder; el número es cuántos turnos duran."))),
        switchInput("Borrar todos los contextos al activarse", intent.resetContexts, (v) => { intent.resetContexts = v; touch(); })));
  }

  function knownContexts() {
    const set = new Set();
    for (const it of agent.intents) {
      it.inputContexts.forEach((c) => set.add(c));
      it.outputContexts.forEach((c) => set.add(c.name));
    }
    return [...set].sort();
  }

  function eventsSection() {
    const chips = chipsInput({
      values: intent.events, placeholder: "Añadir evento (p. ej. WELCOME)",
      transform: (v) => v.toUpperCase().replace(/[^A-Z0-9_.-]+/g, "_"),
      list: ["WELCOME"],
      onChange: (v) => { intent.events = v; touch(); },
    });
    return h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, "Eventos"),
        h("span", { class: "help" }, "Activan la intención sin texto. WELCOME se lanza al abrir el chat.")),
      h("div", { class: "card-body" }, chips));
  }

  // --------------------------------------------------- frases de entrenamiento
  const phrasesBox = h("div");
  let phraseFilter = "";
  function phrasesSection() {
    const input = h("input", { type: "text", placeholder: "Escribe lo que diría un usuario y pulsa Enter", "aria-label": "Nueva frase de entrenamiento" });
    const add = async () => {
      const text = input.value.trim();
      if (!text) return;
      if (intent.trainingPhrases.some((p) => normKey(p.text) === normKey(text))) {
        toast("Esa frase ya está", "error");
        return;
      }
      input.value = "";
      let annotations = [];
      try {
        annotations = (await api.annotate(agent.id, text, intent.id)).annotations;
      } catch (e) { /* sin anotaciones automáticas */ }
      intent.trainingPhrases.unshift({ id: uid("p"), text, annotations });
      syncParams();
      drawPhrases();
      touch();
      input.focus();
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    const filter = h("input", { type: "search", placeholder: "Filtrar", "aria-label": "Filtrar frases", style: { width: "150px" },
      oninput: () => { phraseFilter = filter.value; drawPhrases(); } });
    drawPhrases();
    return h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, "Frases de entrenamiento"),
        h("span", { class: "badge" }, String(intent.trainingPhrases.length)), h("span", { class: "spacer" }), filter),
      h("div", { class: "card-body" },
        h("p", { class: "muted small", style: { margin: "0 0 8px" } },
          intent.isFallback
            ? "En el fallback, las frases son ejemplos negativos: cosas que NO debe entender como otra intención."
            : "Pon al menos 10 formas distintas de decirlo. Selecciona palabras con el ratón para marcarlas como entidades."),
        h("div", { class: "phrase-add" }, input, h("button", { class: "btn", type: "button", onclick: add }, icon("plus"), "Añadir")),
        phrasesBox));
  }

  function drawPhrases() {
    clear(phrasesBox);
    const colorOf = colorMap(intent.parameters);
    const q = normKey(phraseFilter);
    const items = intent.trainingPhrases.filter((p) => !q || normKey(p.text).includes(q));
    if (!intent.trainingPhrases.length) {
      phrasesBox.append(h("div", { class: "empty small" }, "Aún no hay frases."));
      return;
    }
    const list = h("div", { class: "phrase-list" });
    for (const p of items) {
      const row = h("div", { class: "phrase-row" });
      const startEdit = () => {
        const inp = h("input", { type: "text", class: "phrase-edit", value: p.text, "aria-label": "Editar frase" });
        const finish = async (ok) => {
          const text = inp.value.trim();
          if (ok && text && text !== p.text) {
            p.text = text;
            try { p.annotations = (await api.annotate(agent.id, text, intent.id)).annotations; } catch (e) { p.annotations = []; }
            syncParams();
            touch();
          }
          drawPhrases();
        };
        inp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); finish(true); }
          if (e.key === "Escape") { e.preventDefault(); finish(false); }
        });
        inp.addEventListener("blur", () => finish(true));
        clear(row).append(inp);
        inp.focus();
      };
      const phraseEl = annotatedPhrase({
        text: p.text,
        annotations: p.annotations || [],
        getParams: () => intent.parameters,
        getEntities: () => agent.entities,
        systemEntities: state.info.systemEntities,
        colorOf,
        onChange: (anns) => { p.annotations = anns; syncParams(); touch(); },
        onEditText: startEdit,
      });
      row.append(h("span", { class: "quote" }, "“"), phraseEl,
        h("div", { class: "actions row", style: { gap: "2px" } },
          h("button", { class: "btn ghost sm icon-only", type: "button", title: "Editar texto", "aria-label": "Editar frase", onclick: startEdit }, icon("edit")),
          h("button", { class: "btn ghost sm icon-only", type: "button", title: "Borrar", "aria-label": "Borrar frase", onclick: () => {
            intent.trainingPhrases = intent.trainingPhrases.filter((x) => x !== p);
            drawPhrases();
            touch();
          } }, icon("trash"))));
      list.append(row);
    }
    phrasesBox.append(list);
    if (!items.length) phrasesBox.append(h("div", { class: "empty small" }, "Ninguna frase coincide con el filtro."));
  }

  // Crea los parámetros que aparecen en las anotaciones (como Dialogflow)
  function syncParams() {
    let changed = false;
    for (const p of intent.trainingPhrases) {
      for (const a of p.annotations || []) {
        if (!intent.parameters.some((x) => x.name === a.param)) {
          intent.parameters.push({ id: uid("a"), name: a.param, entity: a.entity, required: false, isList: false, prompts: [], defaultValue: "" });
          changed = true;
        }
      }
    }
    if (changed) drawParams();
  }

  // ------------------------------------------------------- parámetros
  const paramsBox = h("div");
  function paramsSection() {
    const action = h("input", { type: "text", value: intent.action, placeholder: "p. ej. pedido.crear", "aria-label": "Acción",
      oninput: () => { intent.action = action.value; touch(); } });
    drawParams();
    return h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, "Acción y parámetros"),
        h("span", { class: "help" }, "Datos que extrae de la frase. Si un obligatorio falta, el bot lo pregunta.")),
      h("div", { class: "card-body col" },
        h("label", { class: "field", style: { maxWidth: "360px" } }, "Acción", action,
          h("span", { class: "hint" }, "Nombre libre que recibe tu webhook o tu aplicación.")),
        paramsBox));
  }

  function renameParam(oldName, newName) {
    for (const p of intent.trainingPhrases) {
      for (const a of p.annotations || []) if (a.param === oldName) a.param = newName;
    }
  }

  function drawParams() {
    clear(paramsBox);
    const colorOf = colorMap(intent.parameters);
    const rows = intent.parameters.map((p, i) => {
      const nameIn = h("input", { type: "text", value: p.name, "aria-label": "Nombre del parámetro", style: { minWidth: "110px" } });
      nameIn.addEventListener("change", () => {
        const v = nameIn.value.trim().replace(/[^\w-]+/g, "_");
        if (!v || intent.parameters.some((x) => x !== p && x.name === v)) { nameIn.value = p.name; toast("Nombre no válido o repetido", "error"); return; }
        renameParam(p.name, v);
        p.name = v;
        drawParams(); drawPhrases(); touch();
      });
      const entBtn = h("button", { class: "btn sm", type: "button", style: { justifyContent: "flex-start", minWidth: "130px" } },
        p.entity || "elegir…", icon("down"));
      entBtn.addEventListener("click", () => {
        popover(entBtn, optionList({
          groups: entityGroups({ entities: agent.entities, systemEntities: state.info.systemEntities }),
          placeholder: "Buscar entidad…",
          onPick: (v) => {
            closePopover();
            const old = p.entity;
            p.entity = v.entity;
            for (const ph of intent.trainingPhrases) for (const a of ph.annotations || []) if (a.param === p.name && a.entity === old) a.entity = v.entity;
            drawParams(); drawPhrases(); touch();
          },
        }));
      });
      const promptsBtn = h("button", { class: "btn sm", type: "button", title: "Preguntas que hace el bot si falta" },
        p.prompts.length ? `${p.prompts.length} pregunta${p.prompts.length > 1 ? "s" : ""}` : "Definir");
      promptsBtn.addEventListener("click", async () => {
        const ta = h("textarea", { rows: "5", placeholder: "¿De qué tamaño la quieres?\n¿Pequeña, mediana o familiar?" });
        ta.value = p.prompts.join("\n");
        const res = await modal({
          title: `Preguntas para «${p.name}»`,
          body: [h("p", { class: "muted small", style: { margin: 0 } }, "Una por línea. Si el usuario no da este dato, el bot hará una de estas preguntas (al azar) y esperará la respuesta."), ta],
          actions: [{ label: "Cancelar", value: null }, { label: "Aceptar", primary: true, value: () => ta.value }],
        });
        if (res == null) return;
        p.prompts = res.split("\n").map((s) => s.trim()).filter(Boolean);
        if (p.prompts.length && !p.required) p.required = true;
        drawParams(); touch();
      });
      const def = h("input", { type: "text", value: p.defaultValue, placeholder: "—", "aria-label": "Valor por defecto",
        title: "Valor si no se dice. Puede ser #contexto.parametro", style: { minWidth: "90px" },
        oninput: () => { p.defaultValue = def.value; touch(); } });
      return h("tr", null,
        h("td", null, h("input", { type: "checkbox", checked: p.required, "aria-label": "Obligatorio", title: "Obligatorio",
          onchange: (e) => { p.required = e.target.checked; touch(); } })),
        h("td", null, h("div", { class: "row" }, h("span", { class: "ann-dot ann-" + colorOf(p.name) }), nameIn)),
        h("td", null, entBtn),
        h("td", null, h("code", { class: "faint" }, "$" + p.name)),
        h("td", null, h("input", { type: "checkbox", checked: p.isList, "aria-label": "Es lista", title: "Recoger todos los valores (lista)",
          onchange: (e) => { p.isList = e.target.checked; touch(); } })),
        h("td", null, promptsBtn),
        h("td", null, def),
        h("td", null, h("button", { class: "btn ghost sm icon-only", type: "button", title: "Quitar parámetro", "aria-label": "Quitar parámetro " + p.name,
          onclick: () => {
            intent.parameters.splice(i, 1);
            for (const ph of intent.trainingPhrases) ph.annotations = (ph.annotations || []).filter((a) => a.param !== p.name);
            drawParams(); drawPhrases(); touch();
          } }, icon("trash"))));
    });
    paramsBox.append(
      intent.parameters.length
        ? h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("thead", null, h("tr", null, ["Oblig.", "Nombre", "Entidad", "Valor", "Lista", "Preguntas", "Por defecto", ""].map((t) => h("th", null, t)))),
          h("tbody", null, rows)))
        : h("div", { class: "muted small" }, "Sin parámetros. Se crean solos al marcar entidades en las frases."),
      h("div", null, h("button", { class: "btn sm", type: "button", style: { marginTop: "8px" }, onclick: () => {
        let n = 1;
        while (intent.parameters.some((x) => x.name === "param" + n)) n++;
        intent.parameters.push({ id: uid("a"), name: "param" + n, entity: "@sys.any", required: false, isList: false, prompts: [], defaultValue: "" });
        drawParams(); touch();
      } }, icon("plus"), "Añadir parámetro")));
  }

  // -------------------------------------------------------- respuestas
  const respBox = h("div", { class: "col", style: { gap: "12px" } });
  function responsesSection() {
    drawResponses();
    const addMenu = h("div", { class: "row wrap" },
      h("button", { class: "btn sm", type: "button", onclick: () => { intent.responses.push({ type: "text", variants: [""] }); drawResponses(true); touch(); } }, icon("plus"), "Mensaje de texto"),
      h("button", { class: "btn sm", type: "button", onclick: () => {
        if (intent.responses.some((r) => r.type === "quickReplies")) return toast("Ya hay respuestas rápidas", "error");
        intent.responses.push({ type: "quickReplies", items: [] }); drawResponses(); touch();
      } }, icon("plus"), "Respuestas rápidas"),
      h("button", { class: "btn sm", type: "button", onclick: () => {
        intent.responses.push({ type: "payload", payload: {} }); drawResponses(); touch();
      } }, icon("plus"), "Payload JSON"));
    return h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, "Respuestas"),
        h("span", { class: "help" }, "Usa $parametro, $parametro.original o #contexto.parametro dentro del texto.")),
      h("div", { class: "card-body col" }, respBox, addMenu,
        h("div", { style: { marginTop: "6px" } }, switchInput("Terminar la conversación tras esta respuesta", intent.endConversation,
          (v) => { intent.endConversation = v; touch(); }))));
  }

  function drawResponses(focusLast = false) {
    clear(respBox);
    if (!intent.responses.length) respBox.append(h("div", { class: "muted small" }, "Sin respuestas: el bot no dirá nada (salvo que responda el webhook)."));
    intent.responses.forEach((r, ri) => {
      const removeBtn = h("button", { class: "btn ghost sm icon-only", type: "button", title: "Quitar bloque", "aria-label": "Quitar bloque",
        onclick: () => { intent.responses.splice(ri, 1); drawResponses(); touch(); } }, icon("trash"));
      if (r.type === "text") {
        const box = h("div", { class: "col", style: { gap: "6px" } });
        r.variants.forEach((v, vi) => {
          const ta = h("textarea", { rows: "1", "aria-label": "Variante de respuesta", style: { minHeight: "36px" }, placeholder: "Texto de la respuesta…" });
          ta.value = v;
          const fit = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + 2 + "px"; };
          ta.addEventListener("input", () => { r.variants[vi] = ta.value; fit(); touch(); });
          requestAnimationFrame(fit);
          box.append(h("div", { class: "row top" }, ta,
            h("button", { class: "btn ghost sm icon-only", type: "button", title: "Quitar variante", "aria-label": "Quitar variante",
              onclick: () => { r.variants.splice(vi, 1); if (!r.variants.length) intent.responses.splice(ri, 1); drawResponses(); touch(); } }, icon("x"))));
        });
        respBox.append(h("div", { class: "feedback" },
          h("div", { class: "row", style: { marginBottom: "6px" } }, h("b", null, "Mensaje de texto"),
            h("span", { class: "muted small" }, r.variants.length > 1 ? `· se elige una de ${r.variants.length} al azar` : ""),
            h("span", { class: "spacer" }), removeBtn),
          box,
          h("button", { class: "btn ghost sm", type: "button", style: { marginTop: "6px" }, onclick: () => { r.variants.push(""); drawResponses(); touch(); focusLastIn(respBox); } },
            icon("plus"), "Otra variante")));
      } else if (r.type === "quickReplies") {
        respBox.append(h("div", { class: "feedback" },
          h("div", { class: "row", style: { marginBottom: "6px" } }, h("b", null, "Respuestas rápidas"),
            h("span", { class: "muted small" }, "· botones que el usuario puede pulsar"), h("span", { class: "spacer" }), removeBtn),
          chipsInput({ values: r.items, placeholder: "Añadir botón", onChange: (v) => { r.items = v; touch(); } })));
      } else if (r.type === "payload") {
        const ta = h("textarea", { rows: "4", class: "mono", "aria-label": "Payload JSON" });
        ta.value = r._raw != null ? r._raw : JSON.stringify(r.payload, null, 2);
        const err = h("div", { class: "small", style: { color: "var(--danger)" } });
        ta.addEventListener("input", () => {
          r._raw = ta.value;
          try { r.payload = JSON.parse(ta.value || "{}"); r._invalid = false; err.textContent = ""; }
          catch (e) { r._invalid = true; err.textContent = "JSON no válido: " + e.message; }
          touch();
        });
        respBox.append(h("div", { class: "feedback" },
          h("div", { class: "row", style: { marginBottom: "6px" } }, h("b", null, "Payload personalizado (JSON)"),
            h("span", { class: "muted small" }, "· para tu aplicación"), h("span", { class: "spacer" }), removeBtn),
          ta, err));
      }
    });
    if (focusLast) focusLastIn(respBox);
  }

  function focusLastIn(box) {
    requestAnimationFrame(() => {
      const all = box.querySelectorAll("textarea");
      if (all.length) all[all.length - 1].focus();
    });
  }

  function fulfillmentSection() {
    const url = (agent.settings.webhook || {}).url;
    return h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, "Webhook"), h("span", { class: "help" }, "Lógica propia: consultar una base de datos, un pedido…")),
      h("div", { class: "card-body col" },
        switchInput("Llamar al webhook en esta intención", intent.webhook, (v) => { intent.webhook = v; touch(); }),
        url ? h("div", { class: "muted small" }, "URL: ", h("code", null, url))
          : h("div", { class: "notice warning" }, icon("alert"), h("div", null, "No hay URL de webhook. Configúrala en ", h("a", { href: agentPath("settings") }, "Ajustes"), "."))));
  }

  function advancedSection() {
    return h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, "Avanzado")),
      h("div", { class: "card-body col" },
        switchInput("Es una intención de fallback", intent.isFallback, (v) => { intent.isFallback = v; touch(); },
          "Se usa cuando el bot no entiende la frase. Sus frases de entrenamiento son ejemplos negativos.")));
  }

  function draw() {
    clear(page);
    page.append(headSection());
    if (intent.isFallback) {
      page.append(h("div", { class: "notice info", style: { marginBottom: "14px" } }, icon("info"),
        "Intención de fallback: responde cuando el bot no entiende. Si tiene contextos de entrada, solo actúa con esos contextos activos."));
    }
    page.append(contextsSection(), eventsSection(), phrasesSection(), paramsSection(), responsesSection(),
      fulfillmentSection(), advancedSection());
    touch();
  }

  draw();
  return { canLeave: () => !dirty(), save };
}
