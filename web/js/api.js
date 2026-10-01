// Cliente de la API REST del servidor.

const TOKEN_KEY = "agente.token";

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) { /* sin almacenamiento local */ }
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function request(method, path, body, { raw = false, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  const token = getToken();
  if (token) opts.headers.Authorization = "Bearer " + token;
  if (body instanceof Blob || body instanceof ArrayBuffer) {
    opts.body = body;
    opts.headers["Content-Type"] = "application/octet-stream";
  } else if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers["Content-Type"] = "application/json";
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch (e) {
    throw new ApiError("No se puede conectar con el servidor. ¿Está en marcha?", 0);
  }
  if (raw) return res;
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch (e) { data = text; }
  }
  if (!res.ok) {
    let msg = (data && data.detail) || res.statusText || "Error";
    if (Array.isArray(msg)) msg = msg.map((d) => d.msg || JSON.stringify(d)).join("; ");
    throw new ApiError(typeof msg === "string" ? msg : JSON.stringify(msg), res.status);
  }
  return data;
}

const enc = encodeURIComponent;
const A = (id) => `/api/agents/${enc(id)}`;

export const api = {
  info: () => request("GET", "/api/info"),
  authCheck: () => request("GET", "/api/auth-check"),
  agents: () => request("GET", "/api/agents"),
  createAgent: (data) => request("POST", "/api/agents", data),
  importAgent: (file, name = "") =>
    request("POST", `/api/agents/import?filename=${enc(file.name || "")}&name=${enc(name)}`, file),
  agent: (id) => request("GET", A(id)),
  updateAgent: (id, changes) => request("PATCH", A(id), changes),
  deleteAgent: (id) => request("DELETE", A(id)),
  duplicateAgent: (id) => request("POST", A(id) + "/duplicate"),
  exportAgent: (id) => request("GET", A(id) + "/export", undefined, { raw: true }),
  train: (id) => request("POST", A(id) + "/train"),
  status: (id) => request("GET", A(id) + "/status"),
  validate: (id) => request("GET", A(id) + "/validate"),

  createIntent: (id, intent) => request("POST", A(id) + "/intents", intent),
  updateIntent: (id, intentId, intent) => request("PUT", `${A(id)}/intents/${enc(intentId)}`, intent),
  deleteIntent: (id, intentId) => request("DELETE", `${A(id)}/intents/${enc(intentId)}`),
  addPhrase: (id, intentId, text, annotations) =>
    request("POST", `${A(id)}/intents/${enc(intentId)}/phrases`, { text, annotations }),

  createEntity: (id, entity) => request("POST", A(id) + "/entities", entity),
  updateEntity: (id, entityId, entity) => request("PUT", `${A(id)}/entities/${enc(entityId)}`, entity),
  deleteEntity: (id, entityId) => request("DELETE", `${A(id)}/entities/${enc(entityId)}`),
  addSynonym: (id, entityId, value, synonym) =>
    request("POST", `${A(id)}/entities/${enc(entityId)}/synonyms`, { value, synonym }),

  annotate: (id, text, intentId) => request("POST", A(id) + "/annotate", { text, intentId }),
  analyze: (id, text, contexts) => request("POST", A(id) + "/analyze", { text, contexts }),
  detect: (id, body, apiKey) =>
    request("POST", A(id) + "/detect", body, { headers: apiKey ? { "X-Api-Key": apiKey } : {} }),
  resetSession: (id, sessionId, apiKey) =>
    request("POST", `${A(id)}/sessions/${enc(sessionId)}/reset`, {},
      { headers: apiKey ? { "X-Api-Key": apiKey } : {} }),

  logs: (id, params) => request("GET", `${A(id)}/logs?` + new URLSearchParams(params)),
  review: (id, logId, body) => request("POST", `${A(id)}/logs/${logId}/review`, body),
  clearLogs: (id) => request("POST", A(id) + "/logs/clear"),
  conversations: (id, params = {}) => request("GET", `${A(id)}/conversations?` + new URLSearchParams(params)),
  conversation: (id, sessionId) => request("GET", `${A(id)}/conversations/${enc(sessionId)}`),
  stats: (id) => request("GET", A(id) + "/stats"),
  model: (id, params = {}) => request("GET", `${A(id)}/model?` + new URLSearchParams(params)),
  explain: (id, text, contexts) => request("POST", A(id) + "/explain", { text, contexts }),
  evaluate: (id, folds = 5) => request("POST", A(id) + "/evaluate", { folds }),
  guide: () => request("GET", "/guia/GUIA.md", undefined, { raw: true }),
};
