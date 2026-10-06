// Machine learning: los proyectos de quien entra, los ejemplos para empezar y crear uno nuevo.
import { ml, getUser } from "../api.js";
import { h, icon, modal, toast, errorToast, timeAgo, fullDate, pageHead, emptyState, stagger, busy } from "../ui.js";
import { navigate, refreshProjects, state } from "../app.js";
import { mlInfo, kindTile, fmtMetric, TASKS, KIND_COLORS } from "../ml-common.js";
import { nf } from "../charts.js";

// los cuatro pasos de cualquier proyecto (lo mismo que hace Azure ML, en sencillo)
const STEPS = [
  { icon: "table", title: "Datos", text: "Sube una tabla (CSV, como una hoja de cálculo) o fotos de cada clase." },
  { icon: "flask", title: "Entrenar", text: "En automático prueba varios algoritmos; o eliges tú uno y sus ajustes." },
  { icon: "chart", title: "Modelos", text: "Mira cómo de bien funciona cada uno y qué ha aprendido por dentro." },
  { icon: "target", title: "Usar", text: "Pruébalo con datos nuevos y publícalo para llamarlo desde tu web." },
];

const KIND_OPTIONS = [
  { value: "table", icon: "table", title: "Tabla (CSV)", text: "Filas y columnas: clasificar, predecir un número o agrupar." },
  { value: "images", icon: "image", title: "Imágenes", text: "Fotos o dibujos por clases: aprende a distinguirlos." },
];

export async function createProjectDialog(preset = {}) {
  const name = h("input", { type: "text", placeholder: "Por ejemplo: Precios de pisos", value: preset.name || "" });
  const desc = h("input", { type: "text", placeholder: "Opcional", value: preset.description || "" });
  let kind = preset.kind || "table";
  const cards = h("div", { class: "tpl-list two", role: "radiogroup", "aria-label": "Tipo de datos" }, KIND_OPTIONS.map((o) => {
    const radio = h("input", { type: "radio", name: "kind", value: o.value, checked: o.value === kind, class: "sr-only",
      onchange: () => { kind = o.value; paint(); } });
    return h("label", { class: "tpl-card", dataset: { value: o.value } }, radio,
      h("span", { class: "li-icon primary" }, icon(o.icon)),
      h("span", null, h("b", null, o.title), h("span", { class: "tpl-sub" }, o.text)));
  }));
  const paint = () => cards.querySelectorAll(".tpl-card").forEach((c) => c.classList.toggle("on", c.dataset.value === kind));
  paint();
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); name.closest(".modal").querySelector(".btn.primary").click(); } });
  const result = await modal({
    title: "Nuevo proyecto",
    body: [
      h("label", { class: "field" }, "Nombre", name),
      h("label", { class: "field" }, "Descripción", desc),
      h("div", { class: "field" }, h("span", null, "¿Con qué datos?"), cards),
      h("p", { class: "muted small", style: { margin: 0 } }, "¿Prefieres empezar con datos ya preparados? Cierra y elige uno de los ejemplos."),
    ],
    actions: [
      { label: "Cancelar", value: null },
      { label: "Crear proyecto", primary: true,
        validate: () => { if (!name.value.trim()) { name.focus(); return false; } return true; },
        value: () => ({ name: name.value.trim(), description: desc.value.trim(), kind }) },
    ],
  });
  if (!result) return;
  try {
    const p = await ml.create(result);
    await refreshProjects();
    toast("Proyecto creado", "success");
    navigate(`#/p/${encodeURIComponent(p.id)}/data`);
  } catch (e) { errorToast(e); }
}

async function createFromExample(ex, btn) {
  await busy(btn, async () => {
    try {
      const p = await ml.create({ name: ex.name, example: ex.id, description: ex.description });
      await refreshProjects();
      toast(`Proyecto «${p.name}» creado con los datos del ejemplo`, "success");
      navigate(`#/p/${encodeURIComponent(p.id)}/data`);
    } catch (e) { errorToast(e); }
  });
}

function projectCard(p) {
  const hasModels = !!p.best;
  const open = () => navigate(`#/p/${encodeURIComponent(p.id)}/${hasModels ? "models" : p.data ? "train" : "data"}`);
  const data = p.kind === "images"
    ? (p.data && p.data.count ? `${p.data.count} imágenes · ${p.data.classes.length} clases` : "Sin imágenes todavía")
    : (p.data ? `${nf(0).format(p.data.rows)} filas · ${p.data.columns} columnas` : "Sin datos todavía");
  return h("div", { class: "card agent-card", tabindex: "0", role: "link", "aria-label": "Abrir " + p.name,
    onclick: open, onkeydown: (e) => { if (e.key === "Enter") open(); } },
  h("div", { class: "row", style: { gap: "12px" } }, kindTile(p),
    h("div", { class: "grow" }, h("h3", { class: "ellipsis" }, p.name),
      h("div", { class: "faint small" }, p.kind === "images" ? "Imágenes" : "Tabla")),
    p.published ? h("span", { class: "badge live", title: "Tiene un modelo publicado: responde en su dirección de la API" }, "Publicado") : null),
  p.description ? h("div", { class: "desc" }, p.description) : null,
  h("div", { class: "stats" }, h("span", null, icon(p.kind === "images" ? "image" : "table"), data)),
  p.best ? h("div", { class: "project-best" }, icon("sparkle"),
    h("span", { class: "grow ellipsis" }, p.best.name), h("b", null, fmtMetric(p.best.metric, p.best.value)))
    : h("div", { class: "project-best" }, icon("flask"), h("span", { class: "grow muted" }, p.data ? "Listo para entrenar" : "Empieza por los datos")),
  h("div", { class: "foot" }, h("span", { title: fullDate(p.updatedAt) }, "Modificado " + timeAgo(p.updatedAt)),
    h("span", { class: "open" }, "Abrir", icon("arrowRight"))));
}

function exampleCard(ex) {
  const btn = h("button", { class: "btn sm", type: "button", onclick: (e) => { e.stopPropagation(); createFromExample(ex, btn); } },
    icon("plus"), "Crear con estos datos");
  const task = TASKS[ex.task];
  return h("div", { class: "card agent-card example-card", dataset: { example: ex.id } },
    h("div", { class: "row", style: { gap: "12px" } },
      h("span", { class: "kind-tile", style: KIND_COLORS[ex.kind] }, icon(ex.icon || "table")),
      h("div", { class: "grow" }, h("h3", { class: "ellipsis" }, ex.name),
        h("div", { class: "faint small" }, task ? task.label : ""))),
    h("div", { class: "desc", style: { WebkitLineClamp: "4" } }, ex.description),
    h("div", { class: "stats" },
      ex.kind === "images"
        ? h("span", null, icon("image"), `${ex.count} imágenes · ${ex.classes.length} clases`)
        : h("span", null, icon("table"), `${nf(0).format(ex.rows)} filas`),
      ex.target ? h("span", null, icon("target"), ex.target) : null),
    h("div", { class: "src", title: ex.source }, ex.source),
    btn);
}

function group({ icon: ic, title, count, help, key }, content) {
  return h("section", { class: "agent-group", dataset: { group: key }, "aria-label": title },
    h("div", { class: "section-head" },
      h("h2", null, icon(ic), title, count ? h("span", { class: "badge" }, String(count)) : null),
      help ? h("p", null, help) : null),
    content);
}

export async function render(el, params, query) {
  const [projects, info] = await Promise.all([ml.projects(), mlInfo()]);
  state.projects = projects;
  const page = h("div", { class: "page cq" },
    pageHead({
      icon: "chart", title: "Machine learning",
      sub: "Enséñale a un modelo con tus datos y mira qué aprende. Todo se entrena aquí, sin servicios de fuera.",
      actions: [h("button", { class: "btn primary", type: "button", onclick: () => createProjectDialog() }, icon("plus"), "Nuevo proyecto")],
    }));
  const steps = h("div", { class: "ml-steps" }, STEPS.map((st, i) => h("div", { class: "ml-step", style: { "--i": i } },
    h("span", { class: "ml-step-ic" }, icon(st.icon)), h("b", null, st.title), h("p", null, st.text))));
  page.append(steps);

  let grid = null;
  if (projects.length) {
    grid = h("div", { class: "agent-cards" }, projects.map(projectCard),
      h("button", { class: "card agent-card new", type: "button", onclick: () => createProjectDialog() },
        h("span", { class: "plus" }, icon("plus")), "Nuevo proyecto"));
  }
  const privacy = !state.info.accounts ? null : getUser()
    ? "Solo los ves tú. Cada proyecto guarda sus datos, sus entrenamientos y sus modelos."
    : "Estás sin cuenta: solo se ven en este navegador.";
  page.append(group({ key: "mine", icon: "layers", title: "Tus proyectos", count: projects.length, help: privacy }, grid ||
    h("div", { class: "card agents-empty" }, emptyState({
      icon: "chart", title: "Todavía no tienes proyectos",
      text: "Empieza con uno de los ejemplos de abajo (ya traen los datos) o crea uno con los tuyos.",
      action: h("button", { class: "btn primary", type: "button", onclick: () => createProjectDialog() }, icon("plus"), "Crear el primero") }))));
  if (grid) stagger(grid);

  const exGrid = h("div", { class: "agent-cards" }, info.examples.map(exampleCard));
  page.append(group({ key: "examples", icon: "book", title: "Ejemplos",
    help: "Datos de verdad listos para practicar. Al elegir uno se crea un proyecto tuyo con una copia de sus datos." }, exGrid));
  stagger(exGrid);
  page.append(h("div", { class: "notice info", style: { marginTop: "20px" } }, icon("info"),
    h("div", null, h("b", null, "¿Vienes de Azure Machine Learning? "),
      "Un proyecto es como un área de trabajo con su ", h("b", null, "recurso de datos"), "; cada entrenamiento es un ",
      h("b", null, "trabajo"), " (automático, como el ML automatizado, o personalizado, como un script de entrenamiento), y publicar un modelo es crear su ",
      h("b", null, "punto de conexión"), ". La guía lo explica paso a paso.")));
  el.append(page);
  if (query && query.get("nuevo")) {
    history.replaceState(null, "", "#/ml");
    createProjectDialog();
  }
}
