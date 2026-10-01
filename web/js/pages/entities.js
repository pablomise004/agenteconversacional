// Entidades: lista y editor.
import { api } from "../api.js";
import { h, icon, clear, chipsInput, toast, errorToast, confirmDialog, promptDialog, switchInput } from "../ui.js";
import { agentPath, navigate, replaceInAgent, state } from "../app.js";

const clone = (x) => JSON.parse(JSON.stringify(x));
const KIND_LABEL = { map: "Con sinónimos", list: "Lista simple", regex: "Expresión regular" };

export async function render(el, [, entityId], query) {
  if (entityId) return renderEditor(el, entityId);
  return renderList(el, query);
}

async function createEntity() {
  const name = await promptDialog("Nueva entidad", {
    label: "Nombre", placeholder: "por ejemplo: producto", okLabel: "Crear",
    hint: "Se usará como @nombre. Sin espacios.",
  });
  if (!name) return;
  try {
    const ent = await api.createEntity(state.agent.id, { name, kind: "map", entries: [] });
    replaceInAgent("entities", ent);
    navigate(agentPath("entities/" + encodeURIComponent(ent.id)));
  } catch (e) { errorToast(e); }
}

function renderList(el, query) {
  const agent = state.agent;
  let tab = query && query.get("tab") === "system" ? "system" : "agent";
  const body = h("div");
  const tabs = h("div", { class: "tabs", role: "tablist" });
  const page = h("div", { class: "page" },
    h("div", { class: "page-head" },
      h("div", { class: "grow" }, h("h1", null, "Entidades"),
        h("div", { class: "sub" }, "Tipos de dato que el bot reconoce dentro de las frases: productos, tamaños, ciudades…")),
      h("button", { class: "btn primary", type: "button", onclick: createEntity }, icon("plus"), "Crear entidad")),
    tabs, body);

  const draw = () => {
    clear(tabs).append(
      h("button", { class: tab === "agent" ? "active" : "", role: "tab", type: "button", onclick: () => { tab = "agent"; draw(); } }, `Del agente (${agent.entities.length})`),
      h("button", { class: tab === "system" ? "active" : "", role: "tab", type: "button", onclick: () => { tab = "system"; draw(); } }, "Del sistema"));
    clear(body);
    if (tab === "system") {
      body.append(h("div", { class: "card" }, h("div", { class: "table-wrap" }, h("table", { class: "table" },
        h("thead", null, h("tr", null, h("th", null, "Entidad"), h("th", null, "Qué reconoce"))),
        h("tbody", null, state.info.systemEntities.map((e) => h("tr", null, h("td", null, h("code", null, e.name)), h("td", { class: "muted" }, e.description))))))),
      h("p", { class: "muted small" }, "Funcionan sin configurar nada. Las fechas y horas se calculan con la zona horaria del agente."));
      return;
    }
    if (!agent.entities.length) {
      body.append(h("div", { class: "card" }, h("div", { class: "empty" }, icon("tag"),
        h("p", null, "Sin entidades propias. Crea una para reconocer, por ejemplo, tus productos con sus sinónimos."),
        h("button", { class: "btn primary", type: "button", onclick: createEntity }, icon("plus"), "Crear entidad"))));
      return;
    }
    const list = h("div", { class: "list" });
    for (const e of [...agent.entities].sort((a, b) => a.name.localeCompare(b.name))) {
      const open = () => navigate(agentPath("entities/" + encodeURIComponent(e.id)));
      list.append(h("div", { class: "list-item", tabindex: "0", role: "link", onclick: open, onkeydown: (ev) => { if (ev.key === "Enter") open(); } },
        h("div", { class: "grow col", style: { gap: "3px" } },
          h("div", { class: "title" }, "@" + e.name),
          h("div", { class: "muted small", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
            e.entries.slice(0, 8).map((x) => x.value).join(", ") + (e.entries.length > 8 ? "…" : ""))),
        h("span", { class: "badge" }, KIND_LABEL[e.kind] || e.kind),
        h("span", { class: "muted small nowrap" }, `${e.entries.length} valores`),
        h("div", { class: "actions" }, h("button", { class: "btn ghost sm icon-only", type: "button", title: "Borrar", "aria-label": "Borrar @" + e.name,
          onclick: async (ev) => {
            ev.stopPropagation();
            if (!await confirmDialog(`Se borrará @${e.name}. Las frases que la usan perderán esas anotaciones.`, { title: "Borrar entidad", okLabel: "Borrar", danger: true })) return;
            try { await api.deleteEntity(agent.id, e.id); replaceInAgent("entities", null, e.id); draw(); toast("Entidad borrada", "success"); }
            catch (err) { errorToast(err); }
          } }, icon("trash")))));
    }
    body.append(h("div", { class: "card" }, list));
  };
  draw();
  el.append(page);
  return null;
}

function toBulk(entity) {
  return entity.entries.map((e) => entity.kind === "map"
    ? [e.value, ...e.synonyms.filter((s) => s !== e.value)].map((x) => (x.includes(",") ? `"${x}"` : x)).join(", ")
    : e.value).join("\n");
}

function fromBulk(text, kind) {
  const entries = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    if (kind !== "map") { entries.push({ value: line.trim(), synonyms: [] }); continue; }
    const parts = [];
    let cur = "", quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) { parts.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    parts.push(cur.trim());
    const clean = parts.filter(Boolean);
    if (clean.length) entries.push({ value: clean[0], synonyms: [...new Set(clean)] });
  }
  return entries;
}

function renderEditor(el, entityId) {
  const agent = state.agent;
  const found = agent.entities.find((e) => e.id === entityId);
  if (!found) {
    el.append(h("div", { class: "page" }, h("div", { class: "notice warning" }, icon("alert"), "Esa entidad no existe."),
      h("p", null, h("a", { href: agentPath("entities") }, "← Volver a las entidades"))));
    return null;
  }
  let ent = clone(found);
  let saved = JSON.stringify(ent);
  let bulk = false;
  const page = h("div", { class: "page" });
  const saveBtn = h("button", { class: "btn primary", type: "button", onclick: () => save() }, icon("check"), "Guardar");
  const dirty = () => JSON.stringify(ent) !== saved;
  const touch = () => { saveBtn.disabled = !dirty(); };
  const entriesBox = h("div");
  let bulkArea = null;

  async function save() {
    if (!dirty()) return;
    if (bulk && bulkArea) ent.entries = fromBulk(bulkArea.value, ent.kind);
    try {
      const res = await api.updateEntity(agent.id, ent.id, ent);
      replaceInAgent("entities", res);
      // renombrar una entidad cambia también las intenciones: recargar
      if (res.name !== JSON.parse(saved).name) state.agent = await api.agent(agent.id);
      ent = clone(res);
      saved = JSON.stringify(ent);
      toast("Entidad guardada", "success");
      draw();
    } catch (e) { errorToast(e); }
  }

  function drawEntries() {
    clear(entriesBox);
    if (bulk) {
      bulkArea = h("textarea", { rows: "12", class: "mono", "aria-label": "Edición masiva",
        placeholder: ent.kind === "map" ? "grande, familiar, XL\nmediana, normal" : "un valor por línea" });
      bulkArea.value = toBulk(ent);
      bulkArea.addEventListener("input", () => { ent.entries = fromBulk(bulkArea.value, ent.kind); touch(); });
      entriesBox.append(h("p", { class: "muted small", style: { margin: "0 0 6px" } },
        ent.kind === "map" ? "Una línea por valor: primero el valor de referencia y luego sus sinónimos, separados por comas." : "Un valor por línea."),
      bulkArea);
      return;
    }
    const rows = ent.entries.map((en, i) => {
      const val = h("input", { type: "text", value: en.value, "aria-label": "Valor", class: ent.kind === "regex" ? "mono" : "",
        oninput: () => {
          const old = en.value;
          en.value = val.value;
          if (ent.kind === "map") en.synonyms = en.synonyms.map((s) => (s === old ? val.value : s));
          touch();
        } });
      return h("tr", null,
        h("td", { style: { width: ent.kind === "map" ? "28%" : "auto" } }, val),
        ent.kind === "map" ? h("td", null, chipsInput({ values: en.synonyms.filter((s) => s !== en.value), placeholder: "Añadir sinónimo",
          onChange: (v) => { en.synonyms = [en.value, ...v.filter((s) => s !== en.value)]; touch(); } })) : null,
        h("td", { style: { width: "40px" } }, h("button", { class: "btn ghost sm icon-only", type: "button", "aria-label": "Quitar valor",
          onclick: () => { ent.entries.splice(i, 1); drawEntries(); touch(); } }, icon("trash"))));
    });
    const newVal = h("input", { type: "text", placeholder: ent.kind === "regex" ? "Nueva expresión regular, p. ej. \\d{5}" : "Nuevo valor y pulsa Enter", "aria-label": "Nuevo valor" });
    const addVal = () => {
      const v = newVal.value.trim();
      if (!v) return;
      if (ent.entries.some((x) => x.value === v)) { toast("Ese valor ya existe", "error"); return; }
      ent.entries.push({ value: v, synonyms: ent.kind === "map" ? [v] : [] });
      newVal.value = "";
      drawEntries(); touch();
      entriesBox.querySelector("input[aria-label='Nuevo valor']").focus();
    };
    newVal.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addVal(); } });
    entriesBox.append(h("div", { class: "table-wrap" }, h("table", { class: "table" },
      h("thead", null, h("tr", null, h("th", null, ent.kind === "regex" ? "Expresión" : "Valor de referencia"), ent.kind === "map" ? h("th", null, "Sinónimos") : null, h("th", null, ""))),
      h("tbody", null, rows,
        h("tr", null, h("td", { colspan: ent.kind === "map" ? "2" : "1" }, h("div", { class: "row" }, newVal, h("button", { class: "btn sm", type: "button", onclick: addVal }, icon("plus"), "Añadir"))), h("td"))))));
    if (ent.kind === "regex") entriesBox.append(regexTester());
  }

  function regexTester() {
    const input = h("input", { type: "text", placeholder: "Escribe un texto para probar las expresiones", "aria-label": "Texto de prueba" });
    const out = h("div", { class: "small muted" });
    input.addEventListener("input", () => {
      clear(out);
      for (const en of ent.entries) {
        try {
          const m = input.value.match(new RegExp(en.value, "i"));
          out.append(h("div", null, h("code", null, en.value), " → ", m ? h("b", null, m[0]) : "sin coincidencia"));
        } catch (e) {
          out.append(h("div", { style: { color: "var(--danger)" } }, h("code", null, en.value), " → no válida"));
        }
      }
    });
    return h("div", { class: "feedback col", style: { marginTop: "12px" } }, h("b", null, "Probar"), input, out,
      h("div", { class: "faint small" }, "La prueba usa el motor del navegador; el servidor usa Python, casi siempre equivalente."));
  }

  function draw() {
    clear(page);
    const name = h("input", { type: "text", class: "big plain grow", value: ent.name, "aria-label": "Nombre de la entidad",
      oninput: () => { ent.name = name.value.replace(/[^\w.-]+/g, "_"); touch(); } });
    const kind = h("select", { "aria-label": "Tipo de entidad", onchange: () => {
      ent.kind = kind.value;
      if (ent.kind === "map") ent.entries.forEach((e) => { if (!e.synonyms.includes(e.value)) e.synonyms.unshift(e.value); });
      else ent.entries.forEach((e) => { e.synonyms = []; });
      drawEntries(); touch();
    } }, Object.entries(KIND_LABEL).map(([k, v]) => h("option", { value: k, selected: ent.kind === k }, v)));
    const bulkBtn = h("button", { class: "btn sm", type: "button", onclick: () => {
      if (bulk && bulkArea) ent.entries = fromBulk(bulkArea.value, ent.kind);
      bulk = !bulk;
      bulkBtn.textContent = bulk ? "Vista de tabla" : "Edición masiva";
      drawEntries();
    } }, bulk ? "Vista de tabla" : "Edición masiva");
    page.append(
      h("div", { class: "page-head" },
        h("a", { class: "btn ghost icon-only", href: agentPath("entities"), title: "Volver", "aria-label": "Volver" }, icon("back")),
        h("span", { style: { fontSize: "18px", fontWeight: 700, color: "var(--faint)" } }, "@"), name,
        h("button", { class: "btn ghost icon-only", type: "button", title: "Borrar entidad", "aria-label": "Borrar entidad", onclick: async () => {
          if (!await confirmDialog(`Se borrará @${ent.name}.`, { title: "Borrar entidad", okLabel: "Borrar", danger: true })) return;
          try { await api.deleteEntity(agent.id, ent.id); replaceInAgent("entities", null, ent.id); saved = JSON.stringify(ent); navigate(agentPath("entities")); }
          catch (e) { errorToast(e); }
        } }, icon("trash")),
        saveBtn),
      h("div", { class: "card" },
        h("div", { class: "card-body col" },
          h("div", { class: "row wrap", style: { gap: "18px" } },
            h("label", { class: "field" }, "Tipo", kind),
            switchInput("Tolerar faltas de ortografía", ent.fuzzy, (v) => { ent.fuzzy = v; touch(); }, "«piza» → pizza"),
            switchInput("Expansión automática", ent.autoExpand, (v) => { ent.autoExpand = v; touch(); },
              "Acepta valores nuevos según su posición en las frases")))),
      h("div", { class: "card" },
        h("div", { class: "card-head" }, h("h2", null, "Valores"), h("span", { class: "badge" }, String(ent.entries.length)),
          h("span", { class: "spacer" }), bulkBtn),
        h("div", { class: "card-body" }, entriesBox)));
    drawEntries();
    touch();
  }
  draw();
  el.append(page);
  return { canLeave: () => !dirty(), save };
}
