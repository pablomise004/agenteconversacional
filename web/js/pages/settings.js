// Ajustes del agente.
import { api } from "../api.js";
import { h, icon, clear, toast, errorToast, confirmDialog, switchInput, copyText, downloadFile, timeAgo } from "../ui.js";
import { navigate, refreshAgents, state } from "../app.js";

const ZONES = ["Europe/Madrid", "Atlantic/Canary", "Europe/London", "Europe/Lisbon", "America/Mexico_City",
  "America/Bogota", "America/Lima", "America/Santiago", "America/Argentina/Buenos_Aires", "America/Caracas",
  "America/New_York", "America/Los_Angeles", "UTC"];

const clone = (x) => JSON.parse(JSON.stringify(x));

export async function render(el) {
  const agent = state.agent;
  let form = {
    name: agent.name, description: agent.description, language: agent.language, timezone: agent.timezone,
    settings: clone(agent.settings),
  };
  let saved = JSON.stringify(form);
  const s = form.settings;
  const saveBtn = h("button", { class: "btn primary", type: "button", onclick: () => save() }, icon("check"), "Guardar");
  const dirty = () => JSON.stringify(form) !== saved;
  const touch = () => { saveBtn.disabled = !dirty(); };

  async function save() {
    if (!dirty()) return;
    try {
      const res = await api.updateAgent(agent.id, form);
      state.agent = res;
      form = { name: res.name, description: res.description, language: res.language, timezone: res.timezone, settings: clone(res.settings) };
      saved = JSON.stringify(form);
      await refreshAgents();
      toast("Ajustes guardados", "success");
      touch();
    } catch (e) { errorToast(e); }
  }

  const input = (obj, key, attrs = {}) => {
    const i = h("input", { type: "text", value: obj[key] ?? "", ...attrs, oninput: () => { obj[key] = i.value; touch(); } });
    return i;
  };

  // ---- umbral
  const thrValue = h("b", null, s.threshold.toFixed(2));
  const thr = h("input", { type: "range", min: "0", max: "1", step: "0.05", value: String(s.threshold), "aria-label": "Umbral de confianza",
    style: { width: "260px" }, oninput: () => { s.threshold = parseFloat(thr.value); thrValue.textContent = s.threshold.toFixed(2); touch(); } });

  // ---- normalización
  const normBox = h("div");
  const drawNorm = () => {
    clear(normBox);
    const rows = Object.entries(s.normalization || {}).map(([k, v]) => h("tr", null,
      h("td", null, h("code", null, k)), h("td", null, "→"), h("td", null, v ? h("code", null, v) : h("span", { class: "faint" }, "(se ignora)")),
      h("td", null, h("button", { class: "btn ghost sm icon-only", type: "button", "aria-label": "Quitar regla", onclick: () => {
        delete s.normalization[k]; drawNorm(); touch();
      } }, icon("trash")))));
    const w = h("input", { type: "text", placeholder: "palabra", "aria-label": "Palabra" });
    const r = h("input", { type: "text", placeholder: "se entiende como", "aria-label": "Reemplazo" });
    const add = () => {
      const k = w.value.trim().toLowerCase();
      if (!k) return;
      s.normalization = { ...(s.normalization || {}), [k]: r.value.trim() };
      drawNorm(); touch();
    };
    r.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    normBox.append(h("div", { class: "table-wrap" }, h("table", { class: "table" }, h("tbody", null, rows,
      h("tr", null, h("td", null, w), h("td", null, "→"), h("td", null, r), h("td", null, h("button", { class: "btn sm", type: "button", onclick: add }, icon("plus"))))))));
  };
  drawNorm();

  // ---- webhook
  const headersBox = h("div", { class: "col", style: { gap: "6px" } });
  const drawHeaders = () => {
    clear(headersBox);
    const entries = Object.entries(s.webhook.headers || {});
    entries.forEach(([k, v]) => {
      const kIn = h("input", { type: "text", value: k, placeholder: "Cabecera", "aria-label": "Nombre de la cabecera" });
      const vIn = h("input", { type: "text", value: v, placeholder: "Valor", "aria-label": "Valor de la cabecera", class: "grow" });
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
      headersBox.append(h("div", { class: "row hdr" }, kIn, vIn, h("button", { class: "btn ghost sm icon-only", type: "button", "aria-label": "Quitar cabecera",
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
      keyBox.append(h("code", { class: "badge outline", style: { height: "auto", padding: "4px 8px" } }, s.apiKey),
        h("button", { class: "btn sm", type: "button", onclick: () => copyText(s.apiKey) }, icon("copy"), "Copiar"),
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
  const modelBox = h("div", { class: "muted small" }, "Cargando…");
  const loadStatus = async () => {
    try {
      const st = await api.status(agent.id);
      clear(modelBox).append(st.trainedVersion
        ? `Entrenado ${timeAgo(st.trainedAt)} con ${st.examples} frases y ${st.intents} intenciones en ${st.ms} ms. ${st.upToDate ? "Está al día." : "Hay cambios: se reentrenará con el próximo mensaje."}`
        : "Aún no entrenado: se entrenará con el primer mensaje.");
    } catch (e) { modelBox.textContent = e.message; }
  };
  loadStatus();

  const lang = h("select", { "aria-label": "Idioma", onchange: () => { form.language = lang.value; touch(); } },
    Object.entries(state.info.languages).map(([k, v]) => h("option", { value: k, selected: k === form.language }, v)));

  el.append(h("div", { class: "page" },
    h("div", { class: "page-head" }, h("div", { class: "grow" }, h("h1", null, "Ajustes"), h("div", { class: "sub" }, agent.name)), saveBtn),

    h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", null, "General")),
      h("div", { class: "card-body col" },
        h("div", { class: "grid-2" },
          h("label", { class: "field" }, "Nombre", input(form, "name")),
          h("label", { class: "field" }, "Idioma", lang, h("span", { class: "hint" }, "Afecta a números, fechas y raíces de las palabras."))),
        h("label", { class: "field" }, "Descripción", input(form, "description")),
        h("label", { class: "field", style: { maxWidth: "340px" } }, "Zona horaria", input(form, "timezone", { list: "tz-list" }),
          h("datalist", { id: "tz-list" }, ZONES.map((z) => h("option", { value: z }))),
          h("span", { class: "hint" }, "Para calcular «mañana», «el lunes»…")))),

    h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", null, "Comprensión")),
      h("div", { class: "card-body col" },
        h("label", { class: "field" }, "Umbral de confianza", h("div", { class: "row" }, thr, thrValue),
          h("span", { class: "hint" }, "Por debajo de este valor responde el fallback («no te he entendido»). Más alto = más prudente; más bajo = se arriesga más. Recomendado: 0.30.")),
        switchInput("Corrección ortográfica", s.spellCorrection, (v) => { s.spellCorrection = v; touch(); },
          "Corrige palabras con faltas comparándolas con el vocabulario del agente («rezervar» → «reservar»)."),
        h("label", { class: "field", style: { maxWidth: "260px" } }, "Duración por defecto de los contextos",
          h("input", { type: "number", min: "1", max: "100", value: String(s.defaultLifespan), oninput: (e) => { s.defaultLifespan = parseInt(e.target.value || "5", 10); touch(); } }),
          h("span", { class: "hint" }, "Turnos que dura un contexto nuevo.")))),

    h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", null, "Reglas de normalización"),
      h("span", { class: "help" }, "Cómo leer palabras concretas: jerga, abreviaturas o errores típicos de tus usuarios.")),
      h("div", { class: "card-body" }, normBox,
        h("p", { class: "muted small", style: { margin: "8px 0 0" } }, "Ya vienen de serie las abreviaturas habituales de chat (q, xq, xfa, tb, finde…)."))),

    h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", null, "Webhook")),
      h("div", { class: "card-body col" },
        h("label", { class: "field" }, "URL", input(s.webhook, "url", { type: "url", placeholder: "https://mi-servidor.com/webhook" }),
          h("span", { class: "hint" }, "Se llama en las intenciones que tengan activado «Llamar al webhook». Formato compatible con Dialogflow ES.")),
        h("div", { class: "field" }, h("span", { style: { fontWeight: 550, fontSize: "13px" } }, "Cabeceras (p. ej. autenticación)"), headersBox),
        h("label", { class: "field", style: { maxWidth: "200px" } }, "Tiempo máximo (segundos)",
          h("input", { type: "number", min: "1", max: "30", value: String(s.webhook.timeout), oninput: (e) => { s.webhook.timeout = parseFloat(e.target.value || "5"); touch(); } })))),

    h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", null, "Seguridad")),
      h("div", { class: "card-body col" },
        h("div", { class: "field" }, h("span", { style: { fontWeight: 550, fontSize: "13px" } }, "Clave de API para hablar con el bot"), keyBox,
          h("span", { class: "hint" }, "Si la pones, las peticiones a /detect deben llevar la cabecera X-Api-Key.")),
        h("div", { class: "notice info" }, icon("info"), h("div", null, "Para proteger esta consola en un servidor público, arráncalo con la variable de entorno ",
          h("code", null, "AGENTE_ADMIN_TOKEN"), " y se pedirá ese token para entrar.")))),

    h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", null, "Modelo y datos")),
      h("div", { class: "card-body col" },
        h("div", { class: "row wrap" }, modelBox, h("span", { class: "spacer" }),
          h("button", { class: "btn sm", type: "button", onclick: async () => {
            try { await api.train(agent.id); toast("Modelo reentrenado", "success"); loadStatus(); } catch (e) { errorToast(e); }
          } }, icon("refresh"), "Reentrenar ahora")),
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
          } }, icon("copy"), "Duplicar agente"),
          h("span", { class: "spacer" }),
          h("button", { class: "btn danger", type: "button", onclick: async () => {
            if (!await confirmDialog(`Se borrará «${agent.name}» con todas sus intenciones, entidades y conversaciones. No se puede deshacer (exporta antes si lo necesitas).`,
              { title: "Borrar agente", okLabel: "Borrar definitivamente", danger: true })) return;
            try {
              await api.deleteAgent(agent.id);
              state.agent = null;
              await refreshAgents();
              toast("Agente borrado", "success");
              navigate("#/agents");
            } catch (e) { errorToast(e); }
          } }, icon("trash"), "Borrar agente"))))));
  touch();
  return { canLeave: () => !dirty(), save };
}
