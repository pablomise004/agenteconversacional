// Compartir un agente con un enlace (servidores con cuentas): quien lo abre guarda su propia copia.
import { api } from "../api.js";
import { h, icon, clear, toast, errorToast, confirmDialog, copyButton, downloadFile, timeAgo, fullDate, pageHead, busy, stagger } from "../ui.js";
import { state } from "../app.js";

const STEPS = [
  ["share", "Crea el enlace", "Un clic aquí abajo. El enlace lleva una copia del agente tal como está ahora."],
  ["message", "Pásalo", "Por WhatsApp, Teams o correo, a quien quieras: no hace falta que tenga cuenta."],
  ["download", "Se guarda su copia", "Quien lo abre pulsa «Guardar en mis agentes». Lo que cambie en su copia no toca la tuya."],
];

export async function render(el) {
  const agent = state.agent;
  const page = h("div", { class: "page share-page cq" });
  el.append(page);
  page.append(pageHead({ icon: "share", title: "Compartir", sub: `Pásale a quien quieras una copia de «${agent.name}» con un enlace.` }));

  const steps = h("div", { class: "share-steps" }, STEPS.map(([ic, title, text], i) => h("div", { class: "share-step" },
    h("span", { class: "share-num" }, String(i + 1)),
    h("span", { class: "share-ic" }, icon(ic)),
    h("b", null, title), h("p", null, text))));
  page.append(stagger(steps));

  const box = h("div", { class: "col", style: { gap: "12px" } }, h("span", { class: "muted small" }, "Cargando…"));
  const url = (code) => `${location.origin}/#/shared/${code}`;
  const draw = (st) => {
    clear(box);
    if (!st.code) {
      const create = h("button", { class: "btn primary", type: "button", onclick: () => busy(create, async () => {
        try { draw(await api.share(agent.id)); toast("Enlace creado: cópialo y compártelo", "success"); } catch (e) { errorToast(e); }
      }) }, icon("share"), "Crear un enlace para compartirlo");
      box.append(h("p", { class: "muted", style: { margin: 0 } }, "Todavía no compartes este agente."), h("div", { class: "row wrap" }, create));
      return;
    }
    const link = h("input", { type: "text", readonly: true, value: url(st.code), "aria-label": "Enlace para compartir",
      class: "share-link", onfocus: (e) => e.target.select() });
    const update = h("button", { class: "btn sm", type: "button", onclick: () => busy(update, async () => {
      try { draw(await api.share(agent.id)); toast("El enlace ya lleva los últimos cambios", "success"); } catch (e) { errorToast(e); }
    }) }, icon("refresh"), "Actualizar con los cambios");
    const stop = h("button", { class: "btn sm danger", type: "button", onclick: async () => {
      if (!await confirmDialog("El enlace dejará de funcionar. Las copias que ya haya guardado la gente se quedan.",
        { title: "Dejar de compartir", okLabel: "Dejar de compartir", danger: true })) return;
      try { await api.unshare(agent.id); draw({ code: null }); toast("Ya no se comparte", "success"); } catch (e) { errorToast(e); }
    } }, icon("x"), "Dejar de compartir");
    box.append(
      h("div", { class: "row share-row" }, link, copyButton(() => url(st.code), { cls: "btn primary" })),
      h("div", { class: "muted small" }, "Copia del agente de ", h("span", { title: fullDate(st.sharedAt) }, timeAgo(st.sharedAt)),
        ". Si cambias el agente, pulsa «Actualizar con los cambios» para que el enlace los lleve."),
      h("div", { class: "row wrap", style: { gap: "8px" } }, update, stop));
  };
  api.shareStatus(agent.id).then(draw).catch((e) => clear(box).append(h("span", { class: "muted small" }, e.message)));

  const exportBtn = h("button", { class: "btn", type: "button", onclick: () => busy(exportBtn, async () => {
    try {
      const res = await api.exportAgent(agent.id);
      downloadFile(`${agent.id}.json`, await res.text());
    } catch (e) { errorToast(e); }
  }) }, icon("download"), "Exportar JSON");

  page.append(
    h("div", { class: "card" },
      h("div", { class: "card-head" }, icon("share"), h("h2", null, "Tu enlace"),
        h("span", { class: "help" }, "Se comparte sin la clave de API ni el webhook.")),
      h("div", { class: "card-body" }, box)),
    h("div", { class: "card" },
      h("div", { class: "card-head" }, icon("download"), h("h2", null, "Para Lince instalado en un ordenador")),
      h("div", { class: "card-body row wrap", style: { gap: "12px" } },
        h("p", { class: "muted grow", style: { margin: 0, flex: "1 1 320px" } }, "Desde el enlace también se puede descargar el agente. ",
          "O descárgalo tú y pásale el fichero: en su Lince, ", h("b", null, "Agentes → Importar"), "."),
        exportBtn)));
  return null;
}
