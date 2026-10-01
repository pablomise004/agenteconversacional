// Entidades: lista y editor.
import { api } from "../api.js";
import {
  h, icon, clear, chipsInput, toast, errorToast, confirmDialog, promptDialog, switchInput, pageHead, emptyState,
  segmented, dataTable, stagger, fold, busy,
} from "../ui.js";
import { agentPath, navigate, replaceInAgent, setPageTitle, state } from "../app.js";

const clone = (x) => JSON.parse(JSON.stringify(x));
const KIND_LABEL = { map: "Con sinónimos", list: "Lista simple", regex: "Expresión regular" };
const KIND_HELP = {
  map: "Cada valor tiene sinónimos: «familiar» ← grande, XL, enorme. El parámetro recibe el valor de referencia.",
  list: "Solo una lista de valores, sin sinónimos.",
  regex: "Expresiones regulares: códigos postales, matrículas, números de pedido…",
};

export async function render(el, [, entityId], query) {
  if (entityId) return renderEditor(el, entityId);
  return renderList(el, query);
}

export async function createEntity() {
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
  const tabs = segmented({
    label: "Tipo de entidades",
    items: [{ key: "agent", label: "Del agente", badge: agent.entities.length }, { key: "system", label: "Del sistema", badge: state.info.systemEntities.length }],
    active: tab,
    onChange: (k) => { tab = k; draw(); },
  });
  const page = h("div", { class: "page" },
    pageHead({
      icon: "tag", title: "Entidades", sub: "Tipos de dato que el bot reconoce dentro de las frases: productos, tamaños, ciudades…",
      actions: [h("button", { class: "btn primary", type: "button", onclick: createEntity }, icon("plus"), "Crear entidad")],
    }),
    tabs, body);

  const draw = () => {
    clear(body);
    if (tab === "system") {
      const search = h("input", { type: "search", placeholder: "Buscar entidad del sistema…", "aria-label": "Buscar entidad del sistema", style: { width: "280px" } });
      const tableBox = h("div");
      const drawTable = () => {
        const q = fold(search.value.trim());
        const rows = state.info.systemEntities.filter((e) => !q || fold(e.name + " " + e.description).includes(q));
        clear(tableBox).append(dataTable({
          columns: [
            { label: "Entidad", key: "name", width: "230px", render: (e) => h("code", null, e.name) },
            { label: "Qué reconoce", key: "description", className: "cell-muted" },
          ],
          rows, sort: { col: 0 }, empty: "Ninguna entidad coincide.",
        }));
      };
      search.addEventListener("input", drawTable);
      drawTable();
      body.append(h("div", { class: "card" },
        h("div", { class: "card-head", style: { paddingBottom: "14px" } }, h("span", { class: "help" }, "Funcionan sin configurar nada. Las fechas y horas se calculan con la zona horaria del agente."),
          h("span", { class: "spacer" }), search),
        h("div", { style: { padding: "0 18px 18px" } }, tableBox)));
      return;
    }
    if (!agent.entities.length) {
      body.append(h("div", { class: "card" }, emptyState({
        icon: "tag", title: "Sin entidades propias",
        text: "Crea una para reconocer, por ejemplo, tus productos con sus sinónimos.",
        action: h("button", { class: "btn primary", type: "button", onclick: createEntity }, icon("plus"), "Crear entidad") })));
      return;
    }
    const list = h("div", { class: "list" });
    for (const e of [...agent.entities].sort((a, b) => a.name.localeCompare(b.name))) {
      const open = () => navigate(agentPath("entities/" + encodeURIComponent(e.id)));
      list.append(h("div", { class: "list-item", tabindex: "0", role: "link", onclick: open, onkeydown: (ev) => { if (ev.key === "Enter") open(); } },
        h("span", { class: "li-icon primary" }, icon(e.kind === "regex" ? "hash" : "tag")),
        h("div", { class: "grow col", style: { gap: "3px" } },
          h("div", { class: "title" }, "@" + e.name),
          h("div", { class: "muted small ellipsis" }, e.entries.slice(0, 8).map((x) => x.value).join(", ") + (e.entries.length > 8 ? "…" : ""))),
        h("span", { class: "badge" }, KIND_LABEL[e.kind] || e.kind),
        h("span", { class: "qty" }, `${e.entries.length} valores`),
        h("div", { class: "actions" }, h("button", { class: "btn ghost sm icon-only", type: "button", title: "Borrar", "aria-label": "Borrar @" + e.name,
          onclick: async (ev) => {
            ev.stopPropagation();
            if (!await confirmDialog(`Se borrará @${e.name}. Las frases que la usan perderán esas anotaciones.`, { title: "Borrar entidad", okLabel: "Borrar", danger: true })) return;
            try { await api.deleteEntity(agent.id, e.id); replaceInAgent("entities", null, e.id); draw(); toast("Entidad borrada", "success"); }
            catch (err) { errorToast(err); }
          } }, icon("trash"))),
        icon("chevRight", "chev")));
    }
    body.append(h("div", { class: "card" }, list));
    stagger(list);
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
  setPageTitle("@" + ent.name, agent.name);
  const page = h("div", { class: "page" });
  const saveBtn = h("button", { class: "btn primary", type: "button", onclick: () => save() }, icon("check"), "Guardar");
  const dirtyPill = h("span", { class: "dirty-pill hidden", title: "Pulsa Guardar o Ctrl+S" }, "Sin guardar");
  const dirty = () => JSON.stringify(ent) !== saved;
  const touch = () => { const d = dirty(); saveBtn.disabled = !d; dirtyPill.classList.toggle("hidden", !d); };
  const entriesBox = h("div");
  const countBadge = h("span", { class: "badge" });
  let bulkArea = null;

  async function save() {
    if (!dirty()) return;
    if (bulk && bulkArea) ent.entries = fromBulk(bulkArea.value, ent.kind);
    try {
      await busy(saveBtn, async () => {
        const res = await api.updateEntity(agent.id, ent.id, ent);
        replaceInAgent("entities", res);
        // renombrar una entidad cambia también las intenciones: recargar
        if (res.name !== JSON.parse(saved).name) state.agent = await api.agent(agent.id);
        ent = clone(res);
        saved = JSON.stringify(ent);
      });
      toast("Entidad guardada", "success");
      setPageTitle("@" + ent.name, agent.name);
      draw();
    } catch (e) { errorToast(e); }
  }

  function drawEntries() {
    clear(entriesBox);
    countBadge.textContent = String(ent.entries.length);
    if (bulk) {
      bulkArea = h("textarea", { rows: "12", class: "mono", "aria-label": "Edición masiva",
        placeholder: ent.kind === "map" ? "grande, familiar, XL\nmediana, normal" : "un valor por línea" });
      bulkArea.value = toBulk(ent);
      bulkArea.addEventListener("input", () => { ent.entries = fromBulk(bulkArea.value, ent.kind); countBadge.textContent = String(ent.entries.length); touch(); });
      entriesBox.append(h("p", { class: "muted small", style: { margin: "0 0 8px" } },
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
        h("td", { style: { width: "48px" } }, h("button", { class: "btn ghost sm icon-only", type: "button", "aria-label": "Quitar valor", title: "Quitar valor",
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
    entriesBox.append(h("div", { class: "table-wrap" }, h("table", { class: "table editable" },
      h("thead", null, h("tr", null, h("th", null, ent.kind === "regex" ? "Expresión" : "Valor de referencia"), ent.kind === "map" ? h("th", null, "Sinónimos") : null, h("th", null, ""))),
      h("tbody", null, rows,
        h("tr", { class: "add-row" }, h("td", { colspan: ent.kind === "map" ? "2" : "1" }, h("div", { class: "row" }, newVal,
          h("button", { class: "btn sm", type: "button", onclick: addVal }, icon("plus"), "Añadir"))), h("td"))))));
    if (ent.kind === "regex") entriesBox.append(regexTester());
  }

  function regexTester() {
    const input = h("input", { type: "text", placeholder: "Escribe un texto para probar las expresiones", "aria-label": "Texto de prueba" });
    const out = h("div", { class: "col small", style: { gap: "4px" } });
    input.addEventListener("input", () => {
      clear(out);
      for (const en of ent.entries) {
        try {
          const m = input.value.match(new RegExp(en.value, "i"));
          out.append(h("div", { class: "row" }, h("code", null, en.value), icon("arrowRight"),
            m ? h("span", { class: "badge success" }, m[0]) : h("span", { class: "faint" }, "sin coincidencia")));
        } catch (e) {
          out.append(h("div", { class: "row" }, h("code", null, en.value), icon("arrowRight"), h("span", { class: "badge danger" }, "no válida")));
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
    const help = h("div", { class: "muted small" }, KIND_HELP[ent.kind]);
    const kind = segmented({
      label: "Tipo de entidad",
      items: Object.entries(KIND_LABEL).map(([key, label]) => ({ key, label })),
      active: ent.kind,
      onChange: (k) => {
        ent.kind = k;
        if (ent.kind === "map") ent.entries.forEach((e) => { if (!e.synonyms.includes(e.value)) e.synonyms.unshift(e.value); });
        else ent.entries.forEach((e) => { e.synonyms = []; });
        help.textContent = KIND_HELP[k];
        drawEntries(); touch();
      },
    });
    kind.style.marginBottom = "0";
    const bulkBtn = h("button", { class: "btn sm", type: "button", onclick: () => {
      if (bulk && bulkArea) ent.entries = fromBulk(bulkArea.value, ent.kind);
      bulk = !bulk;
      clear(bulkBtn).append(icon(bulk ? "list" : "edit"), bulk ? "Vista de tabla" : "Edición masiva");
      drawEntries();
    } }, icon(bulk ? "list" : "edit"), bulk ? "Vista de tabla" : "Edición masiva");
    page.append(
      pageHead({
        sticky: true, icon: "tag",
        crumbs: [{ label: "Entidades", href: agentPath("entities") }, { label: "Editar" }],
        titleNode: h("div", { class: "row", style: { gap: "2px" } },
          h("span", { style: { fontSize: "20px", fontWeight: 700, color: "var(--faint)" } }, "@"), name),
        actions: [dirtyPill,
          h("button", { class: "btn ghost icon-only", type: "button", title: "Borrar entidad", "aria-label": "Borrar entidad", onclick: async () => {
            if (!await confirmDialog(`Se borrará @${ent.name}.`, { title: "Borrar entidad", okLabel: "Borrar", danger: true })) return;
            try { await api.deleteEntity(agent.id, ent.id); replaceInAgent("entities", null, ent.id); saved = JSON.stringify(ent); navigate(agentPath("entities")); }
            catch (e) { errorToast(e); }
          } }, icon("trash")),
          saveBtn],
      }),
      h("div", { class: "card" },
        h("div", { class: "card-head" }, icon("settings"), h("h2", null, "Tipo y comportamiento")),
        h("div", { class: "card-body col", style: { gap: "14px" } },
          h("div", { class: "col", style: { gap: "6px" } }, kind, help),
          h("div", { class: "row wrap", style: { gap: "28px", alignItems: "flex-start" } },
            switchInput("Tolerar faltas de ortografía", ent.fuzzy, (v) => { ent.fuzzy = v; touch(); }, "«piza» → pizza"),
            switchInput("Expansión automática", ent.autoExpand, (v) => { ent.autoExpand = v; touch(); },
              "Acepta valores nuevos según su posición en las frases")))),
      h("div", { class: "card" },
        h("div", { class: "card-head" }, icon("list"), h("h2", null, "Valores"), countBadge, h("span", { class: "spacer" }), bulkBtn),
        h("div", { class: "card-body" }, entriesBox)));
    drawEntries();
    touch();
  }
  draw();
  el.append(page);
  return { canLeave: () => !dirty(), save };
}
