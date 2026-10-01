// Referencia de la API (/docs): lee el esquema OpenAPI del servidor y lo muestra
// con el estilo de la consola. Cada operación tiene un formulario «Pruébalo» que
// envía la petición de verdad y enseña la respuesta.
import {
  h, icon, logo, clear, toast, codeBlock, codeTabs, copyButton, dataTable, fold, initTooltips, syncThemeColor,
  themeButton, confirmDialog, busy,
} from "./ui.js";
import { getToken, setToken } from "./api.js";
import { renderMarkdown } from "./markdown.js";

const METHODS = ["get", "post", "put", "patch", "delete"];
const TAG_LABEL = {
  "conversación": "Conversación", agentes: "Agentes", intenciones: "Intenciones", entidades: "Entidades",
  nlu: "Comprensión (NLU)", entrenamiento: "Entrenamiento", historial: "Historial",
  "compatibilidad Dialogflow": "Compatible con Dialogflow", general: "General",
};
const TAG_ICON = {
  "conversación": "message", agentes: "layers", intenciones: "chat", entidades: "tag", nlu: "text",
  entrenamiento: "pulse", historial: "history", "compatibilidad Dialogflow": "globe", general: "info",
};
const TYPE_LABEL = { string: "texto", integer: "entero", number: "número", boolean: "sí / no", object: "objeto", array: "lista", null: "nulo" };
const IN_LABEL = { path: "ruta", query: "consulta", header: "cabecera" };
const STATUS_TEXT = {
  200: "Correcto", 201: "Creado", 204: "Sin contenido", 400: "Petición incorrecta", 401: "Sin autorización",
  404: "No encontrado", 405: "Método no permitido", 409: "Ya existe", 413: "Demasiado grande", 422: "Datos no válidos",
  500: "Error del servidor",
};
const KEY_STORE = "agente.docs.apiKey";
const HIGHLIGHT_LIMIT = 80000; // por encima, la respuesta se muestra sin colores (más rápido)

let spec = null;
let serverInfo = null;
let agents = [];
let lastOpened = null; // la última operación abierta (para resaltarla en el índice)
const agentDetails = new Map();

const tagLabel = (t) => TAG_LABEL[t] || t.charAt(0).toUpperCase() + t.slice(1);
const slug = (s) => fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function getKey() {
  try { return localStorage.getItem(KEY_STORE) || ""; } catch (e) { return ""; }
}
function setKey(v) {
  try { if (v) localStorage.setItem(KEY_STORE, v); else localStorage.removeItem(KEY_STORE); } catch (e) { /* nada */ }
}

async function getJSON(url) {
  const headers = {};
  if (getToken()) headers.Authorization = "Bearer " + getToken();
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function agentDetail(id) {
  if (!id) return null;
  if (!agentDetails.has(id)) agentDetails.set(id, getJSON("/api/agents/" + encodeURIComponent(id)).catch(() => null));
  return agentDetails.get(id);
}

// ------------------------------------------------------------- esquemas
function resolve(schema) {
  let s = schema || {};
  for (let i = 0; s.$ref && i < 10; i++) s = spec.components.schemas[s.$ref.split("/").pop()] || {};
  return s;
}

function typeLabel(schema) {
  const s = resolve(schema);
  if (s.anyOf || s.oneOf) {
    const alts = (s.anyOf || s.oneOf).map(resolve);
    const names = [...new Set(alts.filter((a) => a.type !== "null").map((a) => typeLabel(a)))];
    return (names.join(" o ") || "cualquiera") + (alts.some((a) => a.type === "null") ? " (o nulo)" : "");
  }
  if (s.type === "array") return "lista de " + typeLabel(s.items || {});
  if (s.format === "binary") return "fichero";
  if (s.type) return TYPE_LABEL[s.type] || s.type;
  return "cualquiera";
}

function constraints(schema) {
  const s = resolve(schema);
  const out = [];
  if (s.minimum != null) out.push(`mín. ${s.minimum}`);
  if (s.maximum != null) out.push(`máx. ${s.maximum}`);
  if (s.minLength != null) out.push(`mín. ${s.minLength} letras`);
  if (s.maxLength != null) out.push(`máx. ${s.maxLength} letras`);
  return out.join(" · ");
}

function sample(schema, depth = 0) {
  const s = resolve(schema);
  if (depth > 3) return null;
  if (s.default !== undefined) return s.default;
  if (s.anyOf) return sample(s.anyOf.find((a) => resolve(a).type !== "null") || {}, depth + 1);
  switch (s.type) {
    case "object": {
      const o = {};
      for (const [k, v] of Object.entries(s.properties || {})) if ((s.required || []).includes(k)) o[k] = sample(v, depth + 1);
      return o;
    }
    case "array": return [];
    case "string": return "texto";
    case "integer": case "number": return 0;
    case "boolean": return false;
    default: return {};
  }
}

function exampleOf(media) {
  if (!media) return undefined;
  if (media.example !== undefined) return media.example;
  if (media.examples) {
    const first = Object.values(media.examples)[0];
    if (first && first.value !== undefined) return first.value;
  }
  const s = resolve(media.schema);
  if (Array.isArray(s.examples) && s.examples.length) return s.examples[0];
  if (s.example !== undefined) return s.example;
  return sample(s);
}

function inlineCode(text) {
  return String(text || "").split(/(`[^`]+`)/).map((p) => (p.startsWith("`") && p.length > 1 ? h("code", null, p.slice(1, -1)) : p));
}

// ---------------------------------------------------------- piezas comunes
function methodPill(method, small = false) {
  return h("span", { class: `method m-${method}${small ? " sm" : ""}` }, method.toUpperCase());
}

function statusPill(code, text = "") {
  const cls = code < 300 ? "ok" : code < 500 ? "warn" : "err";
  return h("span", { class: "status-pill " + cls }, String(code) + (text ? " " + text : ""));
}

function pathNode(path, values = {}) {
  return h("span", { class: "ep-path" }, path.split(/(\{[^}]+\})/).filter(Boolean).map((part) => {
    if (!part.startsWith("{")) return part;
    const v = values[part.slice(1, -1)];
    return h("span", { class: "pp" }, v || part);
  }));
}

function authOf(op) {
  const sec = (op.security || []).flatMap((s) => Object.keys(s));
  return { admin: sec.includes("tokenAdmin"), key: sec.includes("claveApi") };
}

function operations() {
  const groups = new Map((spec.tags || []).map((t) => [t.name, { tag: t.name, description: t.description || "", ops: [] }]));
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const tag = (op.tags && op.tags[0]) || "general";
      if (!groups.has(tag)) groups.set(tag, { tag, description: "", ops: [] });
      const id = `${method}-${path.replace(/[{}]/g, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")}`;
      groups.get(tag).ops.push({ id, method, path, op, tag });
    }
  }
  return [...groups.values()].filter((g) => g.ops.length);
}

// --------------------------------------------------------- documentación
function paramTable(params) {
  return h("div", { class: "table-wrap" }, h("table", { class: "table" },
    h("thead", null, h("tr", null, ["Nombre", "Dónde", "Tipo", "Descripción"].map((t) => h("th", null, t)))),
    h("tbody", null, params.map((p) => {
      const s = resolve(p.schema);
      return h("tr", null,
        h("td", { class: "nowrap" }, h("code", null, p.name), p.required ? h("span", { class: "req" }, "obligatorio") : null),
        h("td", { class: "in-tag" }, IN_LABEL[p.in] || p.in),
        h("td", { class: "cell-muted nowrap" }, typeLabel(s), constraints(s) ? h("div", { class: "faint small" }, constraints(s)) : null),
        h("td", { class: "cell-muted" }, p.description || s.description || "",
          s.default !== undefined && s.default !== null && s.default !== "" ? h("div", { class: "faint small" }, "Por defecto: ", h("code", null, String(s.default))) : null));
    }))));
}

function schemaView(schema) {
  const s = resolve(schema);
  const props = Object.entries(s.properties || {});
  if (!props.length) return h("div", { class: "schema-note" }, s.type === "object" ? "Un objeto JSON (mira el ejemplo)." : typeLabel(s));
  const required = new Set(s.required || []);
  return h("div", { class: "table-wrap" }, h("table", { class: "table" },
    h("thead", null, h("tr", null, ["Campo", "Tipo", "Descripción"].map((t) => h("th", null, t)))),
    h("tbody", null, props.map(([name, p]) => {
      const ps = resolve(p);
      const def = p.default !== undefined ? p.default : ps.default;
      return h("tr", null,
        h("td", { class: "nowrap" }, h("code", null, name), required.has(name) ? h("span", { class: "req" }, "obligatorio") : null),
        h("td", { class: "cell-muted nowrap" }, typeLabel(p), constraints(p) ? h("div", { class: "faint small" }, constraints(p)) : null),
        h("td", { class: "cell-muted" }, p.description || ps.description || "",
          def !== undefined && def !== null && def !== "" ? h("div", { class: "faint small" }, "Por defecto: ", h("code", null, JSON.stringify(def))) : null));
    }))));
}

function responsesView(responses) {
  const list = h("div", { class: "resp-list" });
  for (const [code, r] of Object.entries(responses)) {
    const n = parseInt(code, 10);
    let desc = r.description || "";
    if (desc === "Successful Response") desc = STATUS_TEXT[n] || "Correcto";
    if (desc === "Validation Error") desc = "Datos no válidos: falta un campo o tiene otro tipo";
    list.append(h("div", { class: "resp-item" }, statusPill(n), h("span", null, desc)));
    const ex = r.content && r.content["application/json"] && r.content["application/json"].example;
    if (ex) list.append(codeBlock(JSON.stringify(ex, null, 2), { lang: "Ejemplo de respuesta", json: true }));
  }
  return list;
}

// ------------------------------------------------------------ «Pruébalo»
function suggestions(input, name, agentInput) {
  if (!["agent_id", "intent_id", "entity_id"].includes(name)) return null;
  const id = "dl-" + Math.random().toString(36).slice(2);
  const list = h("datalist", { id });
  input.setAttribute("list", id);
  input.addEventListener("focus", async () => {
    if (name === "agent_id") {
      clear(list).append(...agents.map((a) => h("option", { value: a.id }, a.name)));
      return;
    }
    const agent = await agentDetail(agentInput ? agentInput.value.trim() : "");
    if (!agent) return;
    const items = name === "intent_id" ? agent.intents : agent.entities;
    clear(list).append(...items.map((x) => h("option", { value: x.id }, name === "entity_id" ? "@" + x.name : x.name)));
  });
  return list;
}

function formatSize(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toLocaleString("es-ES", { maximumFractionDigits: 1 })} KB`;
}

function tryPanel(o, mediaType, media) {
  const auth = authOf(o.op);
  const fields = [];
  const urlBox = h("div", { class: "try-url" });
  const form = h("div", { class: "col", style: { gap: "8px" } });
  let agentInput = null;
  for (const p of o.op.parameters || []) {
    if (p.in !== "path" && p.in !== "query") continue;
    const s = resolve(p.schema);
    let input;
    if (s.type === "boolean") {
      input = h("input", { type: "checkbox", checked: s.default === true, "aria-label": p.name });
    } else {
      input = h("input", { type: "text", "aria-label": p.name, autocomplete: "off", spellcheck: "false",
        placeholder: s.default != null && s.default !== "" ? String(s.default) : p.required ? "obligatorio" : "opcional" });
      if (p.name === "agent_id" && agents[0]) input.value = agents[0].id;
      if (p.name === "session_id") input.value = "prueba-docs";
    }
    if (p.name === "agent_id") agentInput = input;
    const list = input.type === "text" ? suggestions(input, p.name, agentInput) : null;
    input.addEventListener("input", drawUrl);
    input.addEventListener("change", drawUrl);
    fields.push({ p, s, input });
    form.append(h("label", { class: "try-field" },
      h("span", null, h("code", null, p.name), h("span", { class: "in-tag" }, (IN_LABEL[p.in] || p.in) + (p.required ? " · obligatorio" : ""))),
      h("span", null, input, list)));
  }
  let bodyArea = null, fileInput = null;
  if (mediaType === "application/json") {
    bodyArea = h("textarea", { "aria-label": "Cuerpo de la petición (JSON)", spellcheck: "false" });
    const ex = exampleOf(media);
    bodyArea.value = ex === undefined ? "" : JSON.stringify(ex, null, 2);
    form.append(h("label", { class: "field" }, "Cuerpo (JSON)", bodyArea));
  } else if (mediaType === "application/octet-stream") {
    fileInput = h("input", { type: "file", accept: ".json,.zip", "aria-label": "Fichero" });
    form.append(h("label", { class: "field" }, "Fichero (JSON o ZIP de Dialogflow)", fileInput));
  }
  const out = h("div");
  const sendBtn = h("button", { class: "btn primary sm", type: "button", onclick: () => send() }, icon("send"), "Enviar");

  function build() {
    let path = o.path;
    const values = {};
    const query = new URLSearchParams();
    const missing = [];
    for (const { p, s, input } of fields) {
      let v = input.type === "checkbox" ? (input.checked ? "true" : s.default === true ? "false" : "") : input.value.trim();
      if (p.in === "path") {
        values[p.name] = v;
        if (!v) missing.push(p.name);
        path = path.replace(`{${p.name}}`, v ? encodeURIComponent(v) : `{${p.name}}`);
      } else if (v !== "") {
        query.set(p.name, v);
      }
    }
    const qs = query.toString();
    return { url: path + (qs ? "?" + qs : ""), values, missing };
  }
  function drawUrl() {
    const { url, values } = build();
    const qs = url.includes("?") ? url.slice(url.indexOf("?")) : "";
    clear(urlBox).append(methodPill(o.method, true), h("span", null, pathNode(o.path, values), qs ? h("b", null, qs) : null));
  }
  function curl() {
    const { url } = build();
    const lines = [`curl -X ${o.method.toUpperCase()} "${location.origin}${url}"`];
    if (auth.admin && getToken()) lines.push(`-H "Authorization: Bearer ${getToken()}"`);
    if (auth.key && getKey()) lines.push(`-H "X-Api-Key: ${getKey()}"`);
    if (bodyArea && bodyArea.value.trim()) {
      let body = bodyArea.value.trim();
      try { body = JSON.stringify(JSON.parse(body)); } catch (e) { /* tal cual */ }
      lines.push('-H "Content-Type: application/json"', `-d '${body.replace(/'/g, "'\\''")}'`);
    }
    if (fileInput) lines.push('-H "Content-Type: application/octet-stream"', "--data-binary @mi-agente.zip");
    return lines.join(" \\\n  ");
  }
  async function send() {
    const file = fileInput && fileInput.files[0];
    if (fileInput && !file) { toast("Elige un fichero", "error"); fileInput.focus(); return; }
    const filenameField = fields.find((f) => f.p.name === "filename");
    if (file && filenameField && !filenameField.input.value.trim()) { filenameField.input.value = file.name; drawUrl(); }
    const { url, missing } = build();
    if (missing.length) {
      toast("Falta " + missing.join(", "), "error");
      fields.find((f) => f.p.name === missing[0]).input.focus();
      return;
    }
    const headers = {};
    if (getToken()) headers.Authorization = "Bearer " + getToken();
    if (getKey()) headers["X-Api-Key"] = getKey();
    let body;
    if (bodyArea && bodyArea.value.trim()) {
      try { JSON.parse(bodyArea.value); } catch (e) { toast("El cuerpo no es JSON válido: " + e.message, "error"); bodyArea.focus(); return; }
      body = bodyArea.value;
      headers["Content-Type"] = "application/json";
    }
    if (file) { body = file; headers["Content-Type"] = "application/octet-stream"; }
    const destructive = ["delete", "put", "patch"].includes(o.method) || /\/(clear|reset)$/.test(o.path);
    const verb = o.method === "delete" ? "borra" : o.method === "put" ? "sustituye" : "cambia";
    if (destructive && !await confirmDialog(`Esta petición ${verb} datos de verdad en este servidor. ¿Enviarla?`,
      { title: "Petición real", okLabel: "Enviar", danger: true })) return;
    await busy(sendBtn, async () => {
      const t0 = performance.now();
      let res, text;
      try {
        res = await fetch(url, { method: o.method.toUpperCase(), headers, body });
        text = await res.text();
      } catch (e) {
        clear(out).append(h("div", { class: "notice danger" }, icon("alert"), "No se puede conectar con el servidor. ¿Está en marcha?"));
        return;
      }
      const ms = Math.round(performance.now() - t0);
      let pretty = text, json = false;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); json = true; } catch (e) { /* no es JSON */ }
      clear(out).append(h("div", { class: "resp" },
        h("div", { class: "resp-head" }, statusPill(res.status, STATUS_TEXT[res.status] || res.statusText),
          h("span", { class: "spacer" }), h("span", { class: "tnum" }, `${ms} ms · ${formatSize(new Blob([text]).size)}`)),
        codeBlock(pretty, { lang: "Respuesta", json: json && pretty.length <= HIGHLIGHT_LIMIT })));
    });
  }
  drawUrl();
  const needsToken = auth.admin && serverInfo && serverInfo.adminTokenRequired && !getToken();
  return h("div", { class: "try" },
    h("h3", null, icon("play"), "Pruébalo", h("span", { class: "spacer" }),
      h("span", { class: "faint small", style: { fontWeight: 400 } }, "envía la petición a este servidor")),
    needsToken ? h("div", { class: "notice warning" }, icon("lock"),
      h("div", null, "Este servidor pide token de administración: escríbelo en ", h("a", { href: "#auth" }, "Autenticación"), ".")) : null,
    urlBox, form,
    h("div", { class: "actions" }, sendBtn, copyButton(curl, { label: "Copiar como curl", cls: "btn sm" })),
    out);
}

// ------------------------------------------------------------ operación
function opCard(o) {
  const auth = authOf(o.op);
  const inner = h("div", { class: "ep-inner" });
  let built = false;
  const head = h("button", { class: "ep-head", type: "button", "aria-expanded": "false", "aria-controls": o.id + "-body" },
    methodPill(o.method), pathNode(o.path), h("span", { class: "ep-sum" }, o.op.summary || ""),
    auth.admin ? h("span", { class: "ep-auth", title: "Necesita el token de administración (si el servidor lo pide)" }, icon("lock")) : null,
    auth.key ? h("span", { class: "ep-auth", title: "Pide la clave de API del agente (si la tiene)" }, icon("key")) : null,
    icon("down", "chev"));
  const card = h("article", { class: "ep", id: o.id }, head, h("div", { class: "ep-body", id: o.id + "-body" }, inner));
  card.toggle = (on = !card.classList.contains("open")) => {
    if (on && !built) { inner.append(opContent(o)); built = true; }
    card.classList.toggle("open", on);
    head.setAttribute("aria-expanded", String(on));
    if (on) {
      lastOpened = o.id;
      history.replaceState(null, "", "#" + o.id);
    }
  };
  head.addEventListener("click", () => card.toggle());
  card.searchText = fold([o.method, o.path, o.op.summary, o.op.description, tagLabel(o.tag)].join(" "));
  return card;
}

function opContent(o) {
  const op = o.op;
  const doc = h("div", { class: "ep-doc" });
  if (op.description) doc.append(renderMarkdown(op.description).el);
  const params = (op.parameters || []).filter((p) => p.in === "path" || p.in === "query");
  if (params.length) doc.append(h("div", { class: "doc-h" }, "Parámetros"), paramTable(params));
  let mediaType = null, media = null;
  if (op.requestBody) {
    [mediaType, media] = Object.entries(op.requestBody.content || {})[0] || [];
    doc.append(h("div", { class: "doc-h" }, "Cuerpo de la petición", mediaType ? h("span", { class: "badge outline" }, mediaType) : null),
      mediaType === "application/octet-stream"
        ? h("div", { class: "schema-note" }, op.requestBody.description || "El fichero, tal cual.")
        : schemaView(media && media.schema));
    const ex = mediaType === "application/json" ? exampleOf(media) : undefined;
    if (ex !== undefined) doc.append(h("div", { class: "doc-h" }, "Ejemplo"), codeBlock(JSON.stringify(ex, null, 2), { lang: "JSON", json: true }));
  }
  doc.append(h("div", { class: "doc-h" }, "Respuestas"), responsesView(op.responses || {}));
  return h("div", { class: "ep-content" }, doc, tryPanel(o, mediaType, media));
}

// ------------------------------------------------------------- secciones
function hero(total, groups) {
  const origin = location.origin;
  const agent = agents[0] ? agents[0].id : "mi-agente";
  return h("section", { class: "docs-hero", id: "intro" },
    h("span", { class: "eyebrow" }, icon("code"), "Referencia de la API"),
    h("h1", null, "La API de ", h("span", { class: "grad" }, "Lince")),
    h("p", { class: "lead" }, "Todo lo que hace la consola se puede hacer por HTTP: crear agentes, entrenarlos y, sobre todo, conversar con ellos desde tu web o tu aplicación. Todas las rutas reciben y devuelven JSON."),
    h("div", { class: "hero-cards" },
      h("div", { class: "card hero-card" }, h("div", { class: "k" }, icon("globe"), "URL base"),
        h("div", { class: "v" }, h("code", { class: "grow" }, origin), copyButton(origin, { label: "", cls: "btn ghost sm icon-only" }))),
      h("div", { class: "card hero-card" }, h("div", { class: "k" }, icon("list"), "Operaciones"),
        h("div", { class: "v" }, `${total} en ${groups.length} grupos`)),
      h("div", { class: "card hero-card" }, h("div", { class: "k" }, icon("braces"), "Esquema OpenAPI 3"),
        h("div", { class: "v" }, h("a", { href: "/openapi.json", target: "_blank", rel: "noopener" }, "openapi.json"),
          h("span", { class: "faint small", style: { fontWeight: 400 } }, "· para Postman, Insomnia…")))),
    h("div", { class: "doc-h", style: { marginTop: "26px" } }, icon("zap"), "Empieza por aquí: envía un mensaje al agente"),
    codeTabs([
      { label: "curl", code: `curl -X POST ${origin}/api/agents/${agent}/detect \\\n  -H "Content-Type: application/json" \\\n  -d '{"sessionId": "usuario-123", "text": "hola"}'` },
      { label: "JavaScript", code: `const res = await fetch("${origin}/api/agents/${agent}/detect", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({ sessionId: "usuario-123", text: "hola" }),\n});\nconst data = await res.json();\nconsole.log(data.fulfillmentText, data.intent, data.parameters);` },
      { label: "Python", code: `import requests\n\nr = requests.post("${origin}/api/agents/${agent}/detect",\n                  json={"sessionId": "usuario-123", "text": "hola"})\ndata = r.json()\nprint(data["fulfillmentText"], data["intent"], data["parameters"])` },
    ]));
}

function authSection(onTokenChange) {
  const tokenIn = h("input", { type: "password", value: getToken(), placeholder: "Token de administración", "aria-label": "Token de administración", autocomplete: "off" });
  const keyIn = h("input", { type: "password", value: getKey(), placeholder: "ak_…", "aria-label": "Clave de API del agente", autocomplete: "off" });
  const reveal = (inp) => h("button", { class: "btn icon-only", type: "button", title: "Mostrar u ocultar", "aria-label": "Mostrar u ocultar",
    onclick: () => { inp.type = inp.type === "password" ? "text" : "password"; } }, icon("eye"));
  tokenIn.addEventListener("change", () => {
    setToken(tokenIn.value.trim());
    toast(tokenIn.value.trim() ? "Token guardado en este navegador" : "Token borrado", "success");
    onTokenChange();
  });
  keyIn.addEventListener("change", () => {
    setKey(keyIn.value.trim());
    toast(keyIn.value.trim() ? "Clave guardada en este navegador" : "Clave borrada", "success");
  });
  const required = serverInfo ? serverInfo.adminTokenRequired : null;
  return h("section", { class: "docs-section", id: "auth" },
    h("h2", null, h("span", { class: "page-icon" }, icon("lock")), "Autenticación"),
    h("p", { class: "sec-desc" }, "Hay dos llaves distintas y las dos son opcionales: solo hacen falta si las has configurado. Lo que escribas aquí se guarda en este navegador y se usa en los formularios «Pruébalo»."),
    h("div", { class: "auth-grid" },
      h("div", { class: "card auth-card" },
        h("div", { class: "card-head" }, icon("shield"), h("h2", null, "Token de administración"),
          required == null ? null : h("span", { class: "badge dot " + (required ? "warning" : "success") }, required ? "este servidor lo pide" : "este servidor no lo pide")),
        h("div", { class: "card-body" },
          h("div", { class: "muted small" }, "Protege todo salvo la conversación. Se activa arrancando el servidor con la variable ",
            h("code", null, "AGENTE_ADMIN_TOKEN"), " y se envía en la cabecera ", h("code", null, "Authorization: Bearer <token>"), "."),
          h("div", { class: "secret" }, tokenIn, reveal(tokenIn)))),
      h("div", { class: "card auth-card" },
        h("div", { class: "card-head" }, icon("key"), h("h2", null, "Clave de API del agente")),
        h("div", { class: "card-body" },
          h("div", { class: "muted small" }, "Protege la conversación (", h("code", null, "/detect"), " y ", h("code", null, ":detectIntent"),
            ") de un agente. Se genera en Ajustes → Seguridad y se envía en la cabecera ", h("code", null, "X-Api-Key"), "."),
          h("div", { class: "secret" }, keyIn, reveal(keyIn))))));
}

function errorsSection() {
  const rows = [
    [400, "La petición no tiene sentido; por ejemplo, una frase vacía."],
    [401, "Falta el token de administración o la clave de API, o no es correcta."],
    [404, "No existe ese agente, intención, entidad o mensaje."],
    [409, "Ya existe algo con ese nombre (por ejemplo, otra entidad @tamano)."],
    [413, "El fichero es demasiado grande (más de 30 MB)."],
    [422, "Los datos no tienen la forma esperada: falta un campo obligatorio o tiene otro tipo."],
  ];
  return h("section", { class: "docs-section", id: "errores" },
    h("h2", null, h("span", { class: "page-icon" }, icon("alert")), "Errores"),
    h("p", { class: "sec-desc" }, "Si algo falla, la respuesta lleva el código HTTP y un JSON con el motivo en español:"),
    codeBlock('{ "detail": "No existe ese agente" }', { lang: "JSON", json: true }),
    h("div", { style: { marginTop: "14px" } }, dataTable({
      rows,
      columns: [
        { label: "Código", value: (r) => r[0], render: (r) => statusPill(r[0], STATUS_TEXT[r[0]]), width: "230px" },
        { label: "Cuándo", value: (r) => r[1], sortable: false, className: "cell-muted" },
      ],
    })));
}

// ---------------------------------------------------------------- página
async function start() {
  initTooltips();
  syncThemeColor();
  const root = document.getElementById("docs");
  try {
    spec = await getJSON("/openapi.json");
  } catch (e) {
    root.append(h("div", { class: "page" }, h("div", { class: "notice danger" }, icon("alert"), "No se puede leer el esquema de la API (/openapi.json): " + e.message)));
    return;
  }
  try { serverInfo = await getJSON("/api/info"); } catch (e) { serverInfo = null; }
  const loadAgents = async () => {
    try { agents = await getJSON("/api/agents"); } catch (e) { agents = []; }
    // los ejemplos de esta página están escritos para la pizzería: si existe, va la primera
    agents.sort((a, b) => (b.id === "pizzeria") - (a.id === "pizzeria"));
    agentDetails.clear();
  };
  await loadAgents();

  const groups = operations();
  const total = groups.reduce((n, g) => n + g.ops.length, 0);
  const search = h("input", { type: "search", placeholder: "Buscar en la API…", "aria-label": "Buscar en la API", autocomplete: "off" });
  const links = [];
  const cards = [];
  const navLink = (href, ic, label) => {
    const a = h("a", { class: "dn-link", href }, icon(ic), label);
    links.push({ target: href.slice(1), a });
    return a;
  };
  const nav = h("nav", { class: "docs-nav", "aria-label": "Índice de la API" },
    navLink("#intro", "book", "Introducción"), navLink("#auth", "lock", "Autenticación"), navLink("#errores", "alert", "Errores"),
    groups.map((g) => [
      h("div", { class: "dn-group", dataset: { tag: g.tag } }, tagLabel(g.tag)),
      g.ops.map((o) => {
        const a = h("a", { class: "dn-op", href: "#" + o.id, title: `${o.method.toUpperCase()} ${o.path}` },
          methodPill(o.method, true), h("span", { class: "ellipsis" }, o.op.summary || o.path));
        links.push({ target: o.id, a, tag: g.tag });
        return a;
      })]));
  const sections = groups.map((g) => h("section", { class: "docs-section", id: "grupo-" + slug(g.tag), dataset: { tag: g.tag } },
    h("h2", null, h("span", { class: "page-icon" }, icon(TAG_ICON[g.tag] || "code")), tagLabel(g.tag),
      h("span", { class: "count" }, `${g.ops.length} ${g.ops.length === 1 ? "operación" : "operaciones"}`)),
    g.description ? h("p", { class: "sec-desc" }, inlineCode(g.description)) : null,
    g.ops.map((o) => { const c = opCard(o); cards.push({ card: c, o }); return c; })));
  const intro = hero(total, groups);
  const auth = authSection(async () => { await loadAgents(); });
  const errors = errorsSection();
  const empty = h("div", { class: "card docs-empty hidden" }, h("div", { class: "empty" }, h("span", { class: "empty-icon" }, icon("search")),
    h("div", { class: "empty-title" }, "Nada coincide"), h("p", null, "Prueba con otra palabra: «detect», «frase», «entidad»…")));
  const main = h("main", { class: "docs-main" }, intro, auth, errors, sections, empty);
  root.append(
    h("header", { class: "docs-top" },
      h("a", { class: "brand", href: "/", title: "Abrir la consola" }, logo(),
        h("div", null, h("div", { class: "brand-name" }, "Lince"), h("div", { class: "brand-sub" }, "Referencia de la API"))),
      h("span", { class: "version hide-sm" }, "v" + spec.info.version),
      h("span", { class: "spacer" }),
      h("div", { class: "docs-search" }, search, h("kbd", null, "/")),
      themeButton(),
      h("a", { class: "btn sm hide-sm", href: "/openapi.json", target: "_blank", rel: "noopener", title: "Esquema OpenAPI (para Postman, Insomnia…)" }, icon("braces"), "openapi.json"),
      h("a", { class: "btn sm primary", href: "/" }, icon("layers"), h("span", { class: "hide-sm" }, "Abrir la consola"))),
    h("div", { class: "docs-layout" }, nav, main));

  // abrir una operación (desde el índice, un enlace o la dirección)
  const openOp = (id, scroll = true) => {
    const item = cards.find((c) => c.o.id === id);
    if (!item) return false;
    item.card.toggle(true);
    if (scroll) item.card.scrollIntoView({ behavior: "smooth", block: "start" });
    item.card.classList.remove("flash");
    void item.card.offsetWidth;
    item.card.classList.add("flash");
    return true;
  };
  nav.addEventListener("click", (e) => {
    const a = e.target.closest("a.dn-op");
    if (!a) return;
    e.preventDefault();
    openOp(a.getAttribute("href").slice(1));
  });
  const fromHash = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    if (!openOp(id)) document.getElementById(id)?.scrollIntoView({ block: "start" });
  };
  window.addEventListener("hashchange", fromHash);
  fromHash();

  // buscador
  search.addEventListener("input", () => {
    const q = fold(search.value.trim());
    let shown = 0;
    for (const { card, o } of cards) {
      const ok = !q || card.searchText.includes(q);
      card.classList.toggle("hidden-by-search", !ok);
      const link = links.find((l) => l.target === o.id);
      if (link) link.a.classList.toggle("hidden-by-search", !ok);
      if (ok) shown++;
    }
    for (const sec of sections) sec.classList.toggle("hidden-by-search", !sec.querySelector(".ep:not(.hidden-by-search)"));
    for (const label of nav.querySelectorAll(".dn-group")) {
      label.classList.toggle("hidden-by-search", !links.some((l) => l.tag === label.dataset.tag && !l.a.classList.contains("hidden-by-search")));
    }
    for (const s of [intro, auth, errors]) s.classList.toggle("hidden", !!q);
    empty.classList.toggle("hidden", shown > 0);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      search.focus();
    }
  });

  // resaltar en el índice lo que se está leyendo
  const targets = links.map((l) => ({ ...l, el: document.getElementById(l.target) })).filter((l) => l.el);
  let frame = 0;
  const spy = () => {
    frame = 0;
    let current = null;
    for (const t of targets) {
      if (t.el.offsetParent === null) continue;
      if (t.el.getBoundingClientRect().top <= 140) current = t;
    }
    // la operación recién abierta manda si está a la vista (al final de la página no llega arriba)
    const opened = lastOpened && targets.find((t) => t.target === lastOpened);
    if (opened) {
      const top = opened.el.getBoundingClientRect().top;
      if (top >= 0 && top < window.innerHeight * 0.6) current = opened;
    }
    for (const t of targets) t.a.classList.toggle("active", t === current);
    if (current) {
      const a = current.a;
      if (a.offsetTop < nav.scrollTop + 40 || a.offsetTop > nav.scrollTop + nav.clientHeight - 60) nav.scrollTop = a.offsetTop - nav.clientHeight / 3;
    }
  };
  window.addEventListener("scroll", () => { if (!frame) frame = requestAnimationFrame(spy); }, { passive: true });
  spy();
}

start();
