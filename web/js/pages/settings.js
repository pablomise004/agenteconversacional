// Ajustes del agente.
import { api } from "../api.js";
import { h, icon, clear, toast, errorToast, confirmDialog, switchInput, copyButton, downloadFile, timeAgo, fullDate, pageHead, busy,
  selectMenu } from "../ui.js";
import { navigate, refreshAgents, state } from "../app.js";

const ZONES = ["Europe/Madrid", "Atlantic/Canary", "Europe/London", "Europe/Lisbon", "America/Mexico_City",
  "America/Bogota", "America/Lima", "America/Santiago", "America/Argentina/Buenos_Aires", "America/Caracas",
  "America/New_York", "America/Los_Angeles", "UTC"];

const clone = (x) => JSON.parse(JSON.stringify(x));

function section(ic, title, help, ...body) {
  return h("div", { class: "card" },
    h("div", { class: "card-head" }, icon(ic), h("h2", null, title), help ? h("span", { class: "help" }, help) : null),
    h("div", { class: "card-body col", style: { gap: "14px" } }, ...body));
}

// Servidores con cuentas: compartir el agente con un enlace (quien lo abre guarda su propia copia)
function shareSection(agent) {
  const box = h("div", { class: "col", style: { gap: "10px" } }, h("span", { class: "muted small" }, "Cargando…"));
  const url = (code) => `${location.origin}/#/shared/${code}`;
  const draw = (st) => {
    clear(box);
    if (!st.code) {
      const create = h("button", { class: "btn primary", type: "button", onclick: () => busy(create, async () => {
        try { draw(await api.share(agent.id)); toast("Enlace creado: cópialo y compártelo", "success"); } catch (e) { errorToast(e); }
      }) }, icon("share"), "Crear un enlace para compartirlo");
      box.append(h("div", { class: "row wrap" }, create));
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
      h("div", { class: "row share-row" }, link, copyButton(() => url(st.code), { cls: "btn" })),
      h("div", { class: "muted small" }, "Copia del agente de ", h("span", { title: fullDate(st.sharedAt) }, timeAgo(st.sharedAt)),
        ". Si lo cambias, pulsa «Actualizar con los cambios» para que el enlace los lleve."),
      h("div", { class: "row wrap", style: { gap: "8px" } }, update, stop));
  };
  api.shareStatus(agent.id).then(draw).catch((e) => clear(box).append(h("span", { class: "muted small" }, e.message)));
  return section("share", "Compartir", null,
    h("p", { class: "muted", style: { margin: 0 } }, "Con el enlace, cualquiera puede guardar una copia de este agente en su cuenta, ",
      "o descargarla para Lince instalado en su ordenador. Tu agente no cambia y nadie más puede tocarlo. Se comparte sin la clave de API ni el webhook."),
    box);
}

export async function render(el) {
  const agent = state.agent;
  const form = {
    name: agent.name, description: agent.description, language: agent.language, timezone: agent.timezone,
    settings: clone(agent.settings),
  };
  let saved = JSON.stringify(form);
  const s = form.settings;
  const saveBtn = h("button", { class: "btn primary", type: "button", onclick: () => save() }, icon("check"), "Guardar");
  const dirtyPill = h("span", { class: "dirty-pill hidden", title: "Pulsa Guardar o Ctrl+S" }, "Sin guardar");
  const dirty = () => JSON.stringify(form) !== saved;
  const touch = () => { const d = dirty(); saveBtn.disabled = !d; dirtyPill.classList.toggle("hidden", !d); };

  async function save() {
    if (!dirty()) return;
    try {
      await busy(saveBtn, async () => {
        // el formulario sigue siendo el mismo objeto: los campos de la página lo editan directamente
        state.agent = await api.updateAgent(agent.id, form);
        saved = JSON.stringify(form);
        await refreshAgents();
      });
      toast("Ajustes guardados", "success");
      touch();
    } catch (e) { errorToast(e); }
  }

  const input = (obj, key, attrs = {}) => {
    const i = h("input", { type: "text", value: obj[key] ?? "", ...attrs, oninput: () => { obj[key] = i.value; touch(); } });
    return i;
  };

  // ---- umbral
  const thrValue = h("span", { class: "range-value" }, s.threshold.toFixed(2));
  const thr = h("input", { type: "range", min: "0", max: "1", step: "0.05", value: String(s.threshold), "aria-label": "Umbral de confianza",
    style: { width: "320px", maxWidth: "100%", "--fill": s.threshold * 100 + "%" },
    oninput: () => {
      s.threshold = parseFloat(thr.value);
      thrValue.textContent = s.threshold.toFixed(2);
      thr.style.setProperty("--fill", s.threshold * 100 + "%");
      touch();
    } });

  // ---- normalización
  const normBox = h("div");
  const drawNorm = () => {
    clear(normBox);
    const rows = Object.entries(s.normalization || {}).map(([k, v]) => h("tr", null,
      h("td", null, h("code", null, k)), h("td", { class: "faint", style: { width: "30px" } }, icon("arrowRight")),
      h("td", null, v ? h("code", null, v) : h("span", { class: "faint" }, "(se ignora)")),
      h("td", { style: { width: "48px" } }, h("button", { class: "btn ghost sm icon-only", type: "button", "aria-label": "Quitar regla", title: "Quitar regla", onclick: () => {
        delete s.normalization[k]; drawNorm(); touch();
      } }, icon("trash")))));
    const w = h("input", { type: "text", placeholder: "palabra", "aria-label": "Palabra" });
    const r = h("input", { type: "text", placeholder: "se entiende como", "aria-label": "Reemplazo" });
    const add = () => {
      const k = w.value.trim().toLowerCase();
      if (!k) { w.focus(); return; }
      s.normalization = { ...(s.normalization || {}), [k]: r.value.trim() };
      drawNorm(); touch();
    };
    r.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    normBox.append(h("div", { class: "table-wrap" }, h("table", { class: "table editable" },
      h("thead", null, h("tr", null, h("th", null, "Palabra"), h("th", null, ""), h("th", null, "Se entiende como"), h("th", null, ""))),
      h("tbody", null, rows,
        h("tr", { class: "add-row" }, h("td", null, w), h("td", { class: "faint" }, icon("arrowRight")), h("td", null, r),
          h("td", null, h("button", { class: "btn sm icon-only", type: "button", "aria-label": "Añadir regla", title: "Añadir regla", onclick: add }, icon("plus"))))))));
  };
  drawNorm();

  // ---- webhook
  const headersBox = h("div", { class: "col", style: { gap: "6px" } });
  const drawHeaders = () => {
    clear(headersBox);
    const entries = Object.entries(s.webhook.headers || {});
    entries.forEach(([k, v]) => {
      const kIn = h("input", { type: "text", value: k, placeholder: "Cabecera", "aria-label": "Nombre de la cabecera", class: "mono", style: { width: "220px" } });
      const vIn = h("input", { type: "text", value: v, placeholder: "Valor", "aria-label": "Valor de la cabecera", class: "grow mono" });
      const sync = () => {
        const next = {};
        for (const row of headersBox.querySelectorAll(".hdr")) {
          const [a, b] = row.querySelectorAll("input");
          if (a.value.trim()) next[a.value.trim()] = b.value;
        }
        s.webhook.headers = next;
        touch();
      };
      kIn.addEventListener("input", sync);
      vIn.addEventListener("input", sync);
      headersBox.append(h("div", { class: "row hdr" }, kIn, vIn, h("button", { class: "btn ghost sm icon-only", type: "button", "aria-label": "Quitar cabecera", title: "Quitar cabecera",
        onclick: () => { delete s.webhook.headers[k]; drawHeaders(); touch(); } }, icon("trash"))));
    });
    headersBox.append(h("div", null, h("button", { class: "btn sm", type: "button", onclick: () => {
      let n = 1;
      while (s.webhook.headers["X-Header-" + n] != null) n++;
      s.webhook.headers = { ...s.webhook.headers, ["X-Header-" + n]: "" };
      drawHeaders(); touch();
    } }, icon("plus"), "Añadir cabecera")));
  };
  drawHeaders();

  // ---- clave de API
  const keyBox = h("div", { class: "row wrap" });
  const drawKey = () => {
    clear(keyBox);
    if (s.apiKey) {
      keyBox.append(h("code", { class: "badge outline", style: { height: "auto", padding: "5px 10px", fontSize: "12.5px" } }, s.apiKey),
        copyButton(s.apiKey, { cls: "btn sm" }),
        h("button", { class: "btn sm danger", type: "button", onclick: () => { s.apiKey = ""; drawKey(); touch(); } }, "Quitar"));
    } else {
      keyBox.append(h("span", { class: "muted small" }, "Sin clave: cualquiera que conozca la dirección puede hablar con el bot (lo normal para un chat público)."),
        h("button", { class: "btn sm", type: "button", onclick: () => {
          const bytes = crypto.getRandomValues(new Uint8Array(18));
          s.apiKey = "ak_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
          drawKey(); touch();
        } }, icon("key"), "Generar clave"));
    }
  };
  drawKey();

  // ---- estado del modelo
  const modelBox = h("div", { class: "row", style: { gap: "10px" } }, h("span", { class: "spinner" }), h("span", { class: "muted small" }, "Cargando…"));
  const loadStatus = async () => {
    try {
      const st = await api.status(agent.id);
      clear(modelBox).append(
        h("span", { class: "badge dot " + (st.trainedVersion ? (st.upToDate ? "success" : "warning") : "") },
          st.trainedVersion ? (st.upToDate ? "al día" : "con cambios") : "sin entrenar"),
        h("span", { class: "muted small" }, st.trainedVersion
          ? `Entrenado ${timeAgo(st.trainedAt)} con ${st.examples} frases y ${st.intents} intenciones en ${st.ms} ms.${st.upToDate ? "" : " Se reentrenará con el próximo mensaje."}`
          : "Se entrenará con el primer mensaje."));
    } catch (e) { modelBox.textContent = e.message; }
  };
  loadStatus();

  const lang = selectMenu({ label: "Idioma", value: form.language, onChange: (v) => { form.language = v; touch(); },
    options: Object.entries(state.info.languages).map(([k, v]) => ({ value: k, label: v })) });
  const retrain = h("button", { class: "btn sm", type: "button", onclick: async () => {
    try { await busy(retrain, () => api.train(agent.id)); toast("Modelo reentrenado", "success"); loadStatus(); } catch (e) { errorToast(e); }
  } }, icon("refresh"), "Reentrenar ahora");

  el.append(h("div", { class: "page" },
    pageHead({ sticky: true, icon: "settings", title: "Ajustes", sub: agent.name, actions: [dirtyPill, saveBtn] }),

    section("bot", "General", null,
      h("div", { class: "grid-2" },
        h("label", { class: "field" }, "Nombre", input(form, "name")),
        h("div", { class: "field" }, h("span", null, "Idioma"), lang, h("span", { class: "hint" }, "Afecta a números, fechas y raíces de las palabras."))),
      h("label", { class: "field" }, "Descripción", input(form, "description")),
      h("label", { class: "field", style: { maxWidth: "360px" } }, "Zona horaria", input(form, "timezone", { list: "tz-list" }),
        h("datalist", { id: "tz-list" }, ZONES.map((z) => h("option", { value: z }))),
        h("span", { class: "hint" }, "Para calcular «mañana», «el lunes»…"))),

    section("target", "Comprensión", null,
      h("div", { class: "field" }, h("span", null, "Umbral de confianza"),
        h("div", { class: "row", style: { gap: "14px" } }, thr, thrValue),
        h("div", { class: "row small faint", style: { width: "320px", maxWidth: "100%", justifyContent: "space-between" } },
          h("span", null, "se arriesga más"), h("span", null, "más prudente")),
        h("span", { class: "hint" }, "Por debajo de este valor responde el fallback («no te he entendido»). Recomendado: 0,30.")),
      switchInput("Corrección ortográfica", s.spellCorrection, (v) => { s.spellCorrection = v; touch(); },
        "Corrige palabras con faltas comparándolas con el vocabulario del agente («rezervar» → «reservar»)."),
      h("label", { class: "field", style: { maxWidth: "260px" } }, "Duración por defecto de los contextos",
        h("input", { type: "number", min: "1", max: "100", value: String(s.defaultLifespan), oninput: (e) => { s.defaultLifespan = parseInt(e.target.value || "5", 10); touch(); } }),
        h("span", { class: "hint" }, "Turnos que dura un contexto nuevo."))),

    section("text", "Reglas de normalización", "Cómo leer palabras concretas: jerga, abreviaturas o errores típicos de tus usuarios.",
      normBox,
      h("p", { class: "muted small", style: { margin: 0 } }, "Ya vienen de serie las abreviaturas habituales de chat (q, xq, xfa, tb, finde…).")),

    section("plug", "Webhook", null,
      h("label", { class: "field" }, "URL", input(s.webhook, "url", { type: "url", placeholder: "https://mi-servidor.com/webhook" }),
        h("span", { class: "hint" }, "Se llama en las intenciones que tengan activado «Llamar al webhook». Formato compatible con Dialogflow ES.")),
      h("div", { class: "field" }, h("span", null, "Cabeceras (p. ej. autenticación)"), headersBox),
      h("label", { class: "field", style: { maxWidth: "200px" } }, "Tiempo máximo (segundos)",
        h("input", { type: "number", min: "1", max: "30", value: String(s.webhook.timeout), oninput: (e) => { s.webhook.timeout = parseFloat(e.target.value || "5"); touch(); } }))),

    section("shield", "Seguridad", null,
      h("div", { class: "field" }, h("span", null, "Clave de API para hablar con el bot"), keyBox,
        h("span", { class: "hint" }, "Si la pones, las peticiones a /detect deben llevar la cabecera X-Api-Key.")),
      state.info.accounts
        ? h("div", { class: "notice info" }, icon("info"), h("div", null, "En este servidor cada uno entra con su usuario: solo tú ves y cambias tus agentes."))
        : h("div", { class: "notice info" }, icon("info"), h("div", null, "Para proteger esta consola en un servidor público, arráncalo con la variable de entorno ",
          h("code", null, "AGENTE_ADMIN_TOKEN"), " y se pedirá ese token para entrar."))),

    section("cpu", "Modelo y datos", null,
      h("div", { class: "row wrap" }, modelBox, h("span", { class: "spacer" }), retrain),
      h("div", { class: "row wrap" },
        h("button", { class: "btn", type: "button", onclick: async () => {
          try {
            const res = await api.exportAgent(agent.id);
            downloadFile(`${agent.id}.json`, await res.text());
          } catch (e) { errorToast(e); }
        } }, icon("download"), "Exportar JSON"),
        h("button", { class: "btn", type: "button", onclick: async () => {
          try {
            const copy = await api.duplicateAgent(agent.id);
            await refreshAgents();
            toast("Copia creada", "success");
            navigate(`#/a/${encodeURIComponent(copy.id)}/intents`);
          } catch (e) { errorToast(e); }
        } }, icon("copy"), "Duplicar agente"))),

    state.info.accounts ? shareSection(agent) : null,

    h("div", { class: "card danger-zone" },
      h("div", { class: "card-head" }, icon("alert"), h("h2", null, "Zona peligrosa")),
      h("div", { class: "card-body row wrap" },
        h("div", { class: "grow" }, h("b", null, "Borrar este agente"),
          h("div", { class: "muted small" }, "Se borran sus intenciones, entidades y conversaciones. No se puede deshacer: exporta antes si lo necesitas.")),
        h("button", { class: "btn danger", type: "button", onclick: async () => {
          if (!await confirmDialog(`Se borrará «${form.name}» con todas sus intenciones, entidades y conversaciones. No se puede deshacer (exporta antes si lo necesitas).`,
            { title: "Borrar agente", okLabel: "Borrar definitivamente", danger: true })) return;
          try {
            await api.deleteAgent(agent.id);
            state.agent = null;
            await refreshAgents();
            toast("Agente borrado", "success");
            navigate("#/agents");
          } catch (e) { errorToast(e); }
        } }, icon("trash"), "Borrar agente")))));
  touch();
  return { canLeave: () => !dirty(), save };
}
