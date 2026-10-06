// Los modelos de un proyecto: todos los que han salido de los entrenamientos, para compararlos, abrirlos,
// publicar uno o borrar los que sobran.
import { ml } from "../api.js";
import { h, icon, toast, errorToast, confirmDialog, pageHead, emptyState, dataTable, timeAgo, fullDate } from "../ui.js";
import { barList, nf } from "../charts.js";
import { navigate, projectPath, reloadProject, state } from "../app.js";
import { fmtMetric, metricName, higherIsBetter, isPct, keepTogether, TASKS } from "../ml-common.js";

export async function render(el) {
  const p = state.project;
  const page = h("div", { class: "page cq" });
  el.append(page);
  const models = p.models || [];
  page.append(pageHead({
    icon: "chart", title: "Modelos",
    sub: "Cada entrenamiento deja uno o varios modelos. Ábrelos para ver cómo funcionan y qué han aprendido.",
    actions: [h("a", { class: "btn primary", href: projectPath("train") }, icon("flask"), "Entrenar")],
  }));
  if (!models.length) {
    page.append(h("div", { class: "card" }, emptyState({ icon: "chart", title: "Todavía no hay modelos",
      text: p.running ? "Hay un entrenamiento en marcha: en cuanto termine aparecerán aquí."
        : "Entrena para crear el primero: en automático salen varios a la vez para compararlos.",
      action: p.running ? h("a", { class: "btn primary", href: projectPath("jobs/" + p.running) }, "Ver cómo va", icon("arrowRight"))
        : h("a", { class: "btn primary", href: projectPath("train") }, icon("flask"), "Entrenar") })));
    return null;
  }
  const publishedId = p.published && p.published.modelId;
  if (p.published) {
    page.append(h("div", { class: "notice success", style: { marginBottom: "16px", alignItems: "center" } }, icon("globe"),
      h("div", { class: "grow" }, "Publicado: ", h("b", null, p.published.name), ". Responde en la dirección de la API del proyecto."),
      h("a", { class: "btn sm", href: projectPath("api") }, "Ver la API", icon("arrowRight"))));
  }

  // por tarea y métrica (en un proyecto de tabla puede haber clasificación, regresión y agrupación)
  const groups = new Map();
  for (const m of models) {
    const key = `${m.task}|${m.metric}|${m.target || ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  for (const [, list] of groups) {
    const m0 = list[0];
    const metric = m0.metric;
    const hib = higherIsBetter(metric);
    const scoreOf = (m) => m.value;
    const task = TASKS[m0.task] ? TASKS[m0.task].label : m0.task;
    const title = m0.task === "clustering" ? "Agrupar" : m0.task === "images" ? "Clasificar imágenes" : `${task}: «${m0.target}»`;
    const publish = async (m) => {
      try {
        await ml.publish(p.id, publishedId === m.id ? null : m.id);
        await reloadProject();
        toast(publishedId === m.id ? "Ya no está publicado" : `Publicado «${m.name}»`, "success");
        navigate(projectPath("models"));
      } catch (e) { errorToast(e); }
    };
    const remove = async (m) => {
      if (!(await confirmDialog(`Se borrará el modelo «${m.name}».` + (publishedId === m.id ? " Es el publicado: la API dejará de responder." : ""),
        { title: "Borrar el modelo", okLabel: "Borrar", danger: true }))) return;
      try {
        await ml.deleteModel(p.id, m.id);
        await reloadProject();
        toast("Modelo borrado", "success");
        navigate(projectPath("models"));
      } catch (e) { errorToast(e); }
    };
    const table = dataTable({
      sort: { col: 1, dir: hib ? "desc" : "asc" },
      columns: [
        { label: "Modelo", key: "name", render: (m) => h("div", { class: "lb-name" }, h("a", { href: projectPath("models/" + m.id) }, keepTogether(m.name)),
          m.id === publishedId ? h("span", { class: "badge live" }, "Publicado") : null,
          m.best ? h("span", { class: "badge primary", title: "El elegido en su entrenamiento" }, icon("sparkle"), "Mejor") : null,
          m.baseline ? h("span", { class: "badge", title: "Siempre dice lo más frecuente" }, "referencia") : null) },
        { label: metricName(metric), value: scoreOf, num: true, desc: hib, render: (m) => h("b", null, fmtMetric(metric, scoreOf(m))) },
        { label: "Validación", value: (m) => (m.cv ? m.cv.mean : null), num: true, render: (m) => (m.cv ? h("span", null, fmtMetric(metric, m.cv.mean),
          h("span", { class: "pm" }, " ±\u00a0" + fmtMetric(metric, m.cv.std).replace(/\s%$/, ""))) : h("span", { class: "faint" }, "—")) },
        { label: "Ajustes", key: "paramsText", render: (m) => h("span", { class: "muted small" }, m.paramsText || "—") },
        { label: "Creado", value: (m) => m.createdAt, num: true, render: (m) => h("span", { class: "muted", title: fullDate(m.createdAt) }, timeAgo(m.createdAt)) },
        { label: "", sortable: false, render: (m) => h("div", { class: "row", style: { justifyContent: "flex-end", gap: "4px" } },
          h("button", { class: "btn sm" + (m.id === publishedId ? "" : " ghost"), type: "button", onclick: () => publish(m),
            title: m.id === publishedId ? "Dejar de publicarlo" : "Que responda en la API del proyecto" },
          icon("globe"), m.id === publishedId ? "Despublicar" : "Publicar"),
          h("button", { class: "btn ghost sm icon-only", type: "button", "aria-label": "Borrar el modelo", title: "Borrar", onclick: () => remove(m) }, icon("trash"))) },
      ],
      rows: list,
    });
    // comparación en barras (las de 0 a 1, en porcentaje; los errores, cuanto más corta mejor)
    const items = [...list].filter((m) => m.value != null).sort((a, b) => (hib ? b.value - a.value : a.value - b.value)).slice(0, 10)
      .map((m) => ({ label: m.name, value: isPct(metric) || metric === "r2" || metric === "silhouette" ? Math.max(0, m.value) : m.value, tip: m.paramsText || m.name }));
    const chart = list.length > 1 ? h("div", { class: "card-body", style: { paddingTop: "4px" } },
      h("div", { class: "chart-title" }, hib ? `${metricName(metric)} (más es mejor)` : `${metricName(metric)} (menos es mejor)`),
      barList({ items, max: isPct(metric) || metric === "r2" || metric === "silhouette" ? 1 : undefined, labelWidth: 210,
        format: (v) => fmtMetric(metric, v) })) : null;
    page.append(h("div", { class: "section-head", style: { marginTop: "6px" } }, h("h2", null, icon(TASKS[m0.task] ? TASKS[m0.task].icon : "chart"), title,
      h("span", { class: "badge" }, String(list.length)))),
    h("div", { class: "card", style: { marginBottom: "24px" } }, chart,
      h("div", { class: "table-wrap", style: { border: 0, borderTop: chart ? "1px solid var(--border)" : 0, borderRadius: chart ? "0 0 var(--radius) var(--radius)" : "var(--radius)" } },
        table.querySelector("table"))));
  }
  page.append(h("p", { class: "muted small" }, `${nf(0).format(models.length)} ${models.length === 1 ? "modelo" : "modelos"} en total. `,
    "Borrar un entrenamiento (en Entrenar) borra también sus modelos."));
  return null;
}
