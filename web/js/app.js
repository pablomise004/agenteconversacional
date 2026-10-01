// Consola: estado global, enrutado por #hash y estructura de la página.
import { api, getToken, setToken } from "./api.js";
import { h, icon, clear, toast, errorToast, modal, confirmDialog, closePopover } from "./ui.js";
import { createSimulator } from "./simulator.js";
import * as agentsPage from "./pages/agents.js";
import * as intentsPage from "./pages/intents.js";
import * as intentEditor from "./pages/intent-editor.js";
import * as entitiesPage from "./pages/entities.js";
import * as analyzerPage from "./pages/analyzer.js";
import * as trainingPage from "./pages/training.js";
import * as historyPage from "./pages/history.js";
import * as integrationsPage from "./pages/integrations.js";
import * as settingsPage from "./pages/settings.js";
import * as learnPage from "./pages/learn.js";
import * as guidePage from "./pages/guide.js";

export const state = {
  info: null,
  agents: [],
  agent: null,
  pending: 0,
};

const NAV = [
  { key: "intents", label: "Intenciones", icon: "chat" },
  { key: "entities", label: "Entidades", icon: "tag" },
  { key: "analyzer", label: "Analizador", icon: "text" },
  { key: "learn", label: "Entrenar", icon: "pulse" },
  { key: "training", label: "Revisión", icon: "training", badge: true },
  { key: "history", label: "Historial", icon: "history" },
  { key: "integrations", label: "Integraciones", icon: "plug" },
  { key: "settings", label: "Ajustes", icon: "settings" },
  { sep: true },
  { key: "guide", label: "Guía", icon: "book" },
];

const ROUTES = [
  [/^agents$/, () => agentsPage],
  [/^guide$/, () => guidePage],
  [/^a\/([^/]+)\/guide$/, () => guidePage],
  [/^a\/([^/]+)\/learn$/, () => learnPage],
  [/^a\/([^/]+)\/intents$/, () => intentsPage],
  [/^a\/([^/]+)\/intents\/([^/]+)$/, () => intentEditor],
  [/^a\/([^/]+)\/entities$/, () => entitiesPage],
  [/^a\/([^/]+)\/entities\/([^/]+)$/, () => entitiesPage],
  [/^a\/([^/]+)\/analyzer$/, () => analyzerPage],
  [/^a\/([^/]+)\/training$/, () => trainingPage],
  [/^a\/([^/]+)\/history$/, () => historyPage],
  [/^a\/([^/]+)\/history\/(.+)$/, () => historyPage],
  [/^a\/([^/]+)\/integrations$/, () => integrationsPage],
  [/^a\/([^/]+)\/settings$/, () => settingsPage],
];

let root, sidebar, mainEl, pageEl, simulator, agentSelect, navEl, topTitle;
let current = null; // página activa {canLeave, destroy}
let currentHash = "";
let ignoreHash = false;

export function navigate(hash) {
  if (!hash.startsWith("#")) hash = "#/" + hash.replace(/^\//, "");
  if (location.hash === hash) route();
  else location.hash = hash;
}

export function agentPath(sub = "") {
  return `#/a/${encodeURIComponent(state.agent ? state.agent.id : "")}${sub ? "/" + sub : ""}`;
}

export async function refreshAgents() {
  state.agents = await api.agents();
  renderAgentPicker();
}

export async function reloadAgent() {
  if (!state.agent) return null;
  state.agent = await api.agent(state.agent.id);
  return state.agent;
}

// Sustituye en el estado una intención/entidad recién guardada
export function replaceInAgent(kind, item, removeId) {
  if (!state.agent) return;
  const list = state.agent[kind];
  if (removeId) {
    state.agent[kind] = list.filter((x) => x.id !== removeId);
    return;
  }
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx >= 0) list[idx] = item;
  else list.push(item);
}

export async function refreshPending() {
  if (!state.agent) return;
  try {
    const s = await api.stats(state.agent.id);
    state.pending = s.pendingReview || 0;
  } catch (e) {
    state.pending = 0;
  }
  renderNav();
}

// ----------------------------------------------------------------- layout
function buildLayout() {
  root = document.getElementById("app");
  clear(root);
  agentSelect = h("select", { "aria-label": "Agente", onchange: onAgentPick });
  navEl = h("nav", { class: "nav", "aria-label": "Secciones" });
  const themeBtn = h("button", { class: "btn ghost sm icon-only", type: "button", title: "Cambiar tema",
    "aria-label": "Cambiar tema claro u oscuro", onclick: toggleTheme }, icon(isDark() ? "sun" : "moon"));
  sidebar = h("aside", { class: "sidebar" },
    h("div", { class: "brand" }, h("div", { class: "logo" }, icon("logo")), h("span", null, "Agente conversacional")),
    h("div", { class: "agent-picker" }, agentSelect),
    navEl,
    h("div", { class: "sidebar-foot" },
      themeBtn,
      h("a", { class: "btn ghost sm", href: "/docs", target: "_blank", rel: "noopener", title: "Documentación de la API" }, "API"),
      h("a", { class: "btn ghost sm", href: "#/agents", title: "Todos los agentes" }, icon("layers"), "Agentes"),
      h("span", { class: "spacer" }),
      h("span", { class: "faint small" }, state.info ? "v" + state.info.version : "")));
  topTitle = h("span", { class: "title grow" }, "");
  const topbar = h("div", { class: "topbar" },
    h("button", { class: "btn ghost icon-only", type: "button", "aria-label": "Menú", onclick: () => root.classList.toggle("menu-open") }, icon("menu")),
    topTitle,
    h("button", { class: "btn ghost icon-only", type: "button", "aria-label": "Probar el agente", onclick: () => setSimOpen(true) }, icon("chat")));
  pageEl = h("div", { id: "page" });
  mainEl = h("main", { class: "main", onclick: () => root.classList.remove("menu-open") }, topbar, pageEl);
  simulator = createSimulator({
    getAgent: () => state.agent,
    onClose: () => setSimOpen(false),
    onTurn: (r) => { refreshPending(); window.dispatchEvent(new CustomEvent("agente:turn", { detail: r })); },
  });
  const simToggle = h("button", { class: "sim-toggle", type: "button", title: "Probar el agente",
    "aria-label": "Abrir el simulador", onclick: () => setSimOpen(true) }, icon("chat"));
  root.append(sidebar, mainEl, simulator.el, simToggle);
  let open = window.innerWidth > 1180;
  try {
    const saved = localStorage.getItem("agente.sim");
    if (saved && window.innerWidth > 1180) open = saved === "1";
  } catch (e) { /* nada */ }
  setSimOpen(open, false);
}

function setSimOpen(open, remember = true) {
  root.classList.toggle("sim-closed", !open);
  if (open) simulator.focus();
  if (remember) {
    try { localStorage.setItem("agente.sim", open ? "1" : "0"); } catch (e) { /* nada */ }
  }
}

function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function toggleTheme(e) {
  const next = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("agente.theme", next); } catch (err) { /* nada */ }
  const btn = e.currentTarget;
  clear(btn).append(icon(next === "dark" ? "sun" : "moon"));
}

function renderAgentPicker() {
  clear(agentSelect);
  for (const a of state.agents) {
    agentSelect.append(h("option", { value: a.id, selected: state.agent && a.id === state.agent.id }, a.name));
  }
  agentSelect.append(h("option", { value: "__all" }, "— Ver todos los agentes —"));
  if (!state.agent) agentSelect.value = "__all";
}

function onAgentPick() {
  const id = agentSelect.value;
  if (id === "__all") navigate("#/agents");
  else navigate(`#/a/${encodeURIComponent(id)}/intents`);
}

function renderNav(active) {
  if (active !== undefined) navEl.dataset.active = active;
  active = navEl.dataset.active || "";
  clear(navEl);
  if (!state.agent) {
    navEl.append(h("a", { href: "#/agents", class: active === "guide" ? "" : "active" }, icon("layers"), "Agentes"),
      h("a", { href: "#/guide", class: active === "guide" ? "active" : "" }, icon("book"), "Guía"));
    return;
  }
  for (const item of NAV) {
    if (item.sep) { navEl.append(h("div", { class: "nav-sep" })); continue; }
    navEl.append(h("a", { href: agentPath(item.key), class: active === item.key ? "active" : "" },
      icon(item.icon), item.label,
      item.badge && state.pending ? h("span", { class: "badge primary" }, String(state.pending)) : null));
  }
}

// ------------------------------------------------------------------ rutas
async function route() {
  const hash = location.hash || "";
  if (ignoreHash) { ignoreHash = false; return; }
  if (current && current.canLeave && !current.canLeave() && hash !== currentHash) {
    const ok = await confirmDialog("Hay cambios sin guardar. Si sales ahora se perderán.",
      { title: "Cambios sin guardar", okLabel: "Salir sin guardar", danger: true });
    if (!ok) {
      ignoreHash = true;
      location.hash = currentHash;
      return;
    }
  }
  closePopover();
  root.classList.remove("menu-open");
  const [path, qs] = hash.replace(/^#\/?/, "").split("?");
  const query = new URLSearchParams(qs || "");
  if (!path) {
    const first = state.agents[0];
    navigate(first ? `#/a/${encodeURIComponent(first.id)}/intents` : "#/agents");
    return;
  }
  let match = null, mod = null;
  for (const [re, loader] of ROUTES) {
    match = path.match(re);
    if (match) { mod = loader(); break; }
  }
  if (!mod) { navigate("#/"); return; }
  const params = match.slice(1).map(decodeURIComponent);
  if (path.startsWith("a/")) {
    const id = params[0];
    if (!state.agent || state.agent.id !== id) {
      try {
        state.agent = await api.agent(id);
      } catch (e) {
        errorToast(e);
        state.agent = null;
        navigate("#/agents");
        return;
      }
      simulator.reset(true);
      refreshPending();
    }
  } else {
    state.agent = null;
  }
  renderAgentPicker();
  const section = path.startsWith("a/") ? path.split("/")[2] : path === "guide" ? "guide" : "";
  renderNav(section);
  topTitle.textContent = state.agent ? state.agent.name : "Agentes";
  if (current && current.destroy) current.destroy();
  current = null;
  currentHash = location.hash;
  clear(pageEl);
  mainEl.scrollTop = 0;
  try {
    current = (await mod.render(pageEl, params, query)) || null;
  } catch (e) {
    console.error(e);
    pageEl.append(h("div", { class: "page" }, h("div", { class: "notice danger" }, icon("alert"), "Error al cargar la página: " + e.message)));
  }
}

async function login() {
  const input = h("input", { type: "password", placeholder: "Token de administración" });
  const token = await modal({
    title: "Acceso a la consola",
    body: [h("p", { class: "muted", style: { margin: 0 } }, "Este servidor está protegido. Escribe el token de administración (variable AGENTE_ADMIN_TOKEN)."), input],
    actions: [{ label: "Entrar", primary: true, value: () => input.value.trim() }],
  });
  setToken(token || "");
}

async function start() {
  try {
    state.info = await api.info();
  } catch (e) {
    document.getElementById("app").append(h("div", { class: "page" }, h("div", { class: "notice danger" }, icon("alert"), e.message)));
    return;
  }
  if (state.info.adminTokenRequired) {
    for (let i = 0; i < 3; i++) {
      try { await api.authCheck(); break; } catch (e) {
        if (getToken()) toast("Token incorrecto", "error");
        await login();
      }
    }
  }
  buildLayout();
  try {
    await refreshAgents();
  } catch (e) {
    errorToast(e);
  }
  window.addEventListener("hashchange", route);
  window.addEventListener("beforeunload", (e) => {
    if (current && current.canLeave && !current.canLeave()) { e.preventDefault(); e.returnValue = ""; }
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && current && current.save) {
      e.preventDefault();
      current.save();
    }
  });
  route();
}

start();
