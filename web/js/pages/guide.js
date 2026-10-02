// Guía de uso: muestra docs/GUIA.md (el mismo texto que se lee en GitHub).
import { api } from "../api.js";
import { h, icon } from "../ui.js";
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
  const sections = headings.filter((x) => x.level === 2);
  const links = new Map();
  const toc = h("nav", { class: "toc", "aria-label": "Índice de la guía" },
    h("div", { class: "toc-title" }, "Contenido"),
    sections.map((x) => {
      const a = h("a", { href: "#", onclick: (e) => {
        e.preventDefault();
        document.getElementById(x.id).scrollIntoView({ behavior: "smooth", block: "start" });
      } }, x.text);
      links.set(x.id, a);
      return a;
    }));
  if (state.agent) {
    toc.append(h("div", { class: "toc-title", style: { marginTop: "16px" } }, "Pruébalo"),
      h("a", { href: agentPath("analyzer") }, "Analizador de frases"),
      h("a", { href: agentPath("learn") }, "Entrenar y ver cómo aprende"));
  }
  page.append(h("div", { class: "guide-layout" }, toc, content));

  // resalta en el índice la sección que se está leyendo
  const main = el.closest(".main");
  let frame = 0;
  const spy = () => {
    frame = 0;
    if (!main) return;
    const top = main.getBoundingClientRect().top + 120;
    let current = sections[0] && sections[0].id;
    for (const s of sections) {
      const node = document.getElementById(s.id);
      if (node && node.getBoundingClientRect().top <= top) current = s.id;
    }
    for (const [id, a] of links) a.classList.toggle("active", id === current);
  };
  const onScroll = () => { if (!frame) frame = requestAnimationFrame(spy); };
  if (main) main.addEventListener("scroll", onScroll, { passive: true });
  spy();
  return { destroy: () => { if (main) main.removeEventListener("scroll", onScroll); } };
}
