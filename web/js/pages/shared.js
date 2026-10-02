// Un agente compartido (#/shared/<código>): qué es y botones para guardar una copia en tu cuenta o
// descargarla para una instalación local. Solo existe en servidores con cuentas.
import { api } from "../api.js";
import { h, icon, avatar, toast, errorToast, busy, fullDate, timeAgo, pageHead, emptyState } from "../ui.js";
import { navigate, refreshAgents, state } from "../app.js";

export async function render(el, [code]) {
  const page = h("div", { class: "page" });
  el.append(page);
  let info;
  try {
    info = await api.shared(code);
  } catch (e) {
    page.append(pageHead({ icon: "share", title: "Agente compartido" }),
      h("div", { class: "card" }, emptyState({ icon: "share", title: "Este enlace ya no existe",
        text: "Quien lo compartió puede haberlo quitado o haber borrado el agente. Pídele uno nuevo.",
        action: h("a", { class: "btn", href: "#/agents" }, icon("layers"), "Ir a mis agentes") })));
    return;
  }
  const langName = (state.info.languages || {})[info.language] || info.language;
  const save = h("button", { class: "btn primary", type: "button", onclick: () => busy(save, async () => {
    try {
      const agent = await api.saveShared(code);
      await refreshAgents();
      toast(`«${agent.name}» está en tus agentes`, "success");
      navigate(`#/a/${encodeURIComponent(agent.id)}/intents`);
    } catch (e) { errorToast(e); }
  }) }, icon("download"), "Guardar en mis agentes");
  const download = h("a", { class: "btn", href: `/api/shared/${encodeURIComponent(code)}/download`, download: "",
    title: "Para importarlo en Lince instalado en tu ordenador (Agentes → Importar)" }, icon("code"), "Descargar JSON");

  page.append(
    pageHead({ icon: "share", title: info.name, sub: "Te han compartido este agente." }),
    h("div", { class: "card shared-card" },
      h("div", { class: "card-body col", style: { gap: "14px" } },
        h("div", { class: "row", style: { gap: "12px" } }, avatar(info.name, "lg"),
          h("div", { class: "grow" }, h("h2", { class: "shared-name" }, info.name),
            h("div", { class: "faint small" }, langName, " · compartido ", h("span", { title: fullDate(info.sharedAt) }, timeAgo(info.sharedAt))))),
        info.description ? h("p", { class: "muted", style: { margin: 0 } }, info.description) : null,
        h("div", { class: "stats shared-stats" },
          h("span", null, icon("chat"), `${info.intents} intenciones`),
          h("span", null, icon("tag"), `${info.entities} entidades`),
          h("span", null, icon("list"), `${info.phrases} frases`)),
        info.intentNames.length ? h("div", { class: "in-chips" },
          info.intentNames.map((n) => h("span", { class: "in-chip" }, n)),
          info.intents > info.intentNames.length ? h("span", { class: "faint small" }, `y ${info.intents - info.intentNames.length} más`) : null) : null,
        h("div", { class: "row wrap", style: { gap: "8px" } }, save, download))),
    h("div", { class: "notice info", style: { marginTop: "16px" } }, icon("info"),
      h("div", null, "Al guardarlo tendrás tu propia copia: lo que cambies no afecta al original, y si su autor lo cambia, tu copia sigue igual. ",
        "Para usarlo en Lince instalado en tu ordenador, descárgalo y ve a ", h("b", null, "Agentes → Importar"), ".")));
}
