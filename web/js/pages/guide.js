// Guía de uso: muestra docs/GUIA.md (el mismo texto que se lee en GitHub).
import { api } from "../api.js";
import { h, icon } from "../ui.js";
import { renderMarkdown } from "../markdown.js";
import { agentPath, state } from "../app.js";

export async function render(el) {
  const page = h("div", { class: "page guide" });
  el.append(page);
  let md;
  try {
    const res = await api.guide();
    if (!res.ok) throw new Error("No se encuentra docs/GUIA.md");
    md = await res.text();
  } catch (e) {
    page.append(h("div", { class: "notice danger" }, icon("alert"), e.message));
    return null;
  }
  const { el: content, headings } = renderMarkdown(md, { base: "/guia/" });
  const toc = h("nav", { class: "toc", "aria-label": "Índice de la guía" },
    h("div", { class: "toc-title" }, "Contenido"),
    headings.filter((x) => x.level === 2).map((x) => h("a", { href: "#", onclick: (e) => {
      e.preventDefault();
      document.getElementById(x.id).scrollIntoView({ behavior: "smooth", block: "start" });
    } }, x.text)));
  if (state.agent) {
    toc.append(h("div", { class: "toc-title", style: { marginTop: "14px" } }, "Pruébalo"),
      h("a", { href: agentPath("analyzer") }, "Analizador de frases"),
      h("a", { href: agentPath("learn") }, "Entrenar y ver cómo aprende"));
  }
  page.append(h("div", { class: "guide-layout" }, toc, content));
  return null;
}
