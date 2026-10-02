// Guía de uso: muestra docs/GUIA.md (el mismo texto que se lee en GitHub).
import { api } from "../api.js";
import { h, icon, tocNav } from "../ui.js";
import { renderMarkdown } from "../markdown.js";
import { agentPath, state } from "../app.js";

export async function render(el) {
  const page = h("div", { class: "page guide cq" });
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
  const extra = state.agent ? [h("div", { class: "toc-title" }, "Pruébalo"),
    h("a", { href: agentPath("analyzer") }, "Analizador de frases"),
    h("a", { href: agentPath("learn") }, "Entrenar y ver cómo aprende")] : null;
  const toc = tocNav({
    label: "Índice de la guía",
    scroller: el.closest(".main"),
    items: headings.filter((x) => x.level === 2).map((x) => ({ text: x.text, target: () => document.getElementById(x.id) })),
    extra,
  });
  page.append(h("div", { class: "guide-layout" }, toc.el, content));
  return { destroy: toc.destroy };
}
