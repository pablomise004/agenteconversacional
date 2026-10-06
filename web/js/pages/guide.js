// Guía de uso: muestra docs/GUIA.md (el mismo texto que se lee en GitHub); en machine learning, docs/ML.md.
import { api } from "../api.js";
import { h, icon, tocNav } from "../ui.js";
import { renderMarkdown } from "../markdown.js";
import { agentPath, projectPath, state } from "../app.js";

export async function render(el) {
  const page = h("div", { class: "page guide cq" });
  el.append(page);
  const isMl = state.mode === "ml";
  const file = isMl ? "ML.md" : "GUIA.md";
  let md;
  try {
    const res = await api.guide(file);
    if (!res.ok) throw new Error("No se encuentra docs/" + file);
    md = await res.text();
  } catch (e) {
    page.append(h("div", { class: "notice danger" }, icon("alert"), e.message));
    return null;
  }
  const { el: content, headings } = renderMarkdown(md, { base: "/guia/" });
  const extra = isMl
    ? [h("div", { class: "toc-title" }, state.project ? "Pruébalo" : "Más"),
      state.project ? h("a", { href: projectPath("train") }, "Entrenar un modelo") : h("a", { href: "#/ml" }, "Tus proyectos"),
      h("a", { href: state.project ? projectPath("inside") : "#/ml/inside" }, "Por dentro: las fórmulas"),
      h("a", { href: "#/guide" }, "Guía de los chatbots")]
    : [state.agent ? [h("div", { class: "toc-title" }, "Pruébalo"),
      h("a", { href: agentPath("analyzer") }, "Analizador de frases"),
      h("a", { href: agentPath("learn") }, "Entrenar y ver cómo aprende")] : h("div", { class: "toc-title" }, "Más"),
    h("a", { href: "#/ml/guide" }, "Guía de machine learning")];
  const toc = tocNav({
    label: "Índice de la guía",
    scroller: el.closest(".main"),
    items: headings.filter((x) => x.level === 2).map((x) => ({ text: x.text, target: () => document.getElementById(x.id) })),
    extra,
  });
  page.append(h("div", { class: "guide-layout" }, toc.el, content));
  return { destroy: toc.destroy };
}
