// Consola: estado global, enrutado por #hash y estructura de la página.
import { api, getToken, setToken } from "./api.js";
import {
  h, icon, logo, avatar, clear, toast, errorToast, modal, confirmDialog, closePopover, popover, optionList,
  initTooltips, skeletonPage, reducedMotion, syncThemeColor, themeButton,
} from "./ui.js";
import { createSimulator } from "./simulator.js";
import { openPalette } from "./palette.js";
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

export const APP_NAME = "Lince";
// Versión de la consola; debe coincidir con app/__init__.py (lo comprueba tests/test_api.py)
export const APP_VERSION = "0.4.1";

export const state = {
  info: null,
  agents: [],
  agent: null,
  pending: 0,
};

// Secciones de un agente, agrupadas según el flujo de trabajo
export const NAV = [
  { group: "Construir" },
  { key: "intents", label: "Intenciones", icon: "chat" },
  { key: "entities", label: "Entidades", icon: "tag" },
  { group: "Probar y mejorar" },
  { key: "analyzer", label: "Analizador", icon: "text" },
  { key: "learn", label: "Entrenar", icon: "pulse" },
  { key: "training", label: "Revisión", icon: "training", badge: true },
  { key: "history", label: "Historial", icon: "history" },
  { group: "Publicar" },
  { key: "integrations", label: "Integraciones", icon: "plug" },
  { key: "settings", label: "Ajustes", icon: "settings" },
  { group: "Ayuda" },
  { key: "guide", label: "Guía", icon: "book" },
  { href: "/docs", label: "API", icon: "code", external: true },
];

const SECTION_TITLES = Object.fromEntries([...NAV.filter((n) => n.key).map((n) => [n.key, n.label]), ["agents", "Agentes"]]);

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

let root, sidebar, mainEl, pageEl, simulator, navEl, topTitle, agentBtn;
let current = null; // página activa {canLeave, destroy, save}
let currentHash = "";
let ignoreHash = false;
let pillPos = null; // dónde estaba el indicador de la navegación (para animarlo)
let lastPending = 0;

export function navigate(hash) {
  if (!hash.startsWith("#")) hash = "#/" + hash.replace(/^\//, "");
  if (location.hash === hash) route();
  else location.hash = hash;
}

export function agentPath(sub = "") {
  return `#/a/${encodeURIComponent(state.agent ? state.agent.id : "")}${sub ? "/" + sub : ""}`;
}

export function setPageTitle(...parts) {
  document.title = [...parts.filter(Boolean), APP_NAME].join(" · ");
}

export async function refreshAgents() {
  state.agents = await api.agents();
  renderAgentSwitch();
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

export function openSimulator(text) {
  setSimOpen(true);
  if (text) simulator.send(text);
}

// ------------------------------------------------------- aviso de versión
// Tras un «git pull» los ficheros de web/ ya son nuevos (se sirven tal cual), pero el servidor
// sigue con el código Python de antes hasta que se reinicia: se avisa de qué hacer.
function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function versionNotice() {
  const server = state.info.version;
  const cmp = compareVersions(server, APP_VERSION);
  let title, text, action = null;
  if (cmp < 0 || state.info.restartNeeded) {
    title = "Reinicia el servidor para terminar de actualizar";
    text = (cmp < 0 ? `La consola ya es la versión ${APP_VERSION}, pero el servidor sigue con la ${server}. `
      : "El código del servidor ha cambiado desde que se arrancó. ")
      + "Cierra su ventana (o pulsa Ctrl+C en ella) y vuelve a abrir iniciar.bat o python -m app.";
  } else if (cmp > 0) {
    title = "Hay una versión nueva de la consola";
    text = `El servidor ya va por la ${server} y esta pestaña tiene guardada la ${APP_VERSION}.`;
    action = h("button", { class: "btn sm", type: "button", onclick: () => location.reload() }, icon("refresh"), "Recargar");
  } else {
    return null;
  }
  const box = h("div", { class: "version-notice", role: "status" },
    h("div", { class: "notice warning" }, icon("alert"),
      h("div", { class: "grow" }, h("b", null, title), h("div", null, text)),
      action,
      h("button", { class: "btn ghost sm icon-only", type: "button", "aria-label": "Cerrar aviso", onclick: () => box.remove() }, icon("x"))));
  return box;
}

// ----------------------------------------------------------------- layout
function buildLayout() {
  root = document.getElementById("app");
  clear(root);
  navEl = h("nav", { class: "nav", "aria-label": "Secciones" });
  agentBtn = h("button", { class: "agent-switch", type: "button", "aria-haspopup": "listbox", "aria-expanded": "false",
    title: "Cambiar de agente", onclick: openAgentMenu });
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  sidebar = h("aside", { class: "sidebar" },
    h("a", { class: "brand", href: "#/agents", "aria-label": APP_NAME + ": todos los agentes" }, logo(),
      h("div", null, h("div", { class: "brand-name" }, APP_NAME), h("div", { class: "brand-sub" }, "Chatbots en español"))),
    agentBtn,
    h("button", { class: "search-btn", type: "button", onclick: () => openPalette(), "aria-label": "Buscar y saltar a cualquier sitio" },
      icon("search"), h("span", null, "Buscar…"), h("kbd", null, isMac ? "⌘ K" : "Ctrl K")),
    navEl,
    h("div", { class: "sidebar-foot" },
      themeButton(),
      h("a", { class: "btn ghost sm", href: "#/agents", title: "Todos los agentes" }, icon("layers"), "Agentes"),
      h("span", { class: "spacer" }),
      h("span", { class: "version", title: "Versión de " + APP_NAME }, state.info ? "v" + state.info.version : "")));
  topTitle = h("span", { class: "title grow ellipsis" }, "");
  const topbar = h("div", { class: "topbar" },
    h("button", { class: "btn ghost icon-only", type: "button", "aria-label": "Menú",
      onclick: (e) => { e.stopPropagation(); root.classList.toggle("menu-open"); } }, icon("menu")),
    logo(), topTitle,
    h("button", { class: "btn ghost icon-only", type: "button", "aria-label": "Buscar", onclick: () => openPalette() }, icon("search")),
    h("button", { class: "btn ghost icon-only", type: "button", "aria-label": "Probar el agente", onclick: () => setSimOpen(true) }, icon("chat")));
  pageEl = h("div", { id: "page" });
  mainEl = h("main", { class: "main", onclick: () => root.classList.remove("menu-open") }, topbar, versionNotice(), pageEl);
  mainEl.addEventListener("scroll", () => {
    const head = pageEl.querySelector(".page-head.sticky");
    if (head) head.classList.toggle("stuck", mainEl.scrollTop > 6);
  }, { passive: true });
  simulator = createSimulator({
    getAgent: () => state.agent,
    onClose: () => setSimOpen(false),
    onTurn: (r) => { refreshPending(); window.dispatchEvent(new CustomEvent("agente:turn", { detail: r })); },
  });
  const simToggle = h("button", { class: "sim-toggle", type: "button", title: "Probar el agente",
    "aria-label": "Abrir el simulador", onclick: () => setSimOpen(true) }, icon("message"));
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

function renderAgentSwitch() {
  clear(agentBtn);
  const a = state.agent;
  if (a) {
    agentBtn.append(avatar(a.name),
      h("span", { class: "grow" }, h("div", { class: "name ellipsis" }, a.name),
        h("div", { class: "meta ellipsis" }, `${a.intents.length} intenciones · ${(a.language || "").toUpperCase()}`)),
      icon("chevUpDown"));
  } else {
    agentBtn.append(h("span", { class: "avatar", style: { "--av1": "#a1a1aa", "--av2": "#71717a" } }, icon("layers")),
      h("span", { class: "grow" }, h("div", { class: "name" }, "Elige un agente"),
        h("div", { class: "meta" }, `${state.agents.length} ${state.agents.length === 1 ? "agente" : "agentes"}`)),
      icon("chevUpDown"));
  }
}

function openAgentMenu() {
  const groups = [{
    title: "Agentes",
    options: state.agents.map((a) => ({ label: a.name, value: a.id, avatar: a.name,
      sub: `${a.intents} ${a.intents === 1 ? "intención" : "intenciones"} · ${(a.language || "es").toUpperCase()}`,
      selected: !!state.agent && a.id === state.agent.id })),
  }];
  popover(agentBtn, h("div", { class: "agent-menu" },
    optionList({ groups, placeholder: "Buscar agente…", onPick: (id) => { closePopover(); navigate(`#/a/${encodeURIComponent(id)}/intents`); } }),
    h("div", { class: "pop-sep" }),
    h("button", { class: "opt", type: "button", onclick: () => { closePopover(); navigate("#/agents"); } }, icon("layers"), "Ver todos los agentes"),
    h("button", { class: "opt", type: "button", onclick: () => { closePopover(); agentsPage.createAgentDialog(); } }, icon("plus"), "Nuevo agente…")),
  { width: agentBtn.offsetWidth });
}

function renderNav(active) {
  if (active !== undefined) navEl.dataset.active = active;
  active = navEl.dataset.active || "";
  clear(navEl);
  const pill = h("span", { class: "nav-pill", "aria-hidden": "true" });
  navEl.append(pill);
  const items = state.agent ? NAV : [
    { key: "agents", label: "Agentes", icon: "layers", href: "#/agents" },
    { key: "guide", label: "Guía", icon: "book", href: "#/guide" },
    { href: "/docs", label: "API", icon: "code", external: true },
  ];
  for (const item of items) {
    if (item.group) { navEl.append(h("div", { class: "nav-label" }, item.group)); continue; }
    const on = !!item.key && active === item.key;
    const badge = item.badge && state.pending
      ? h("span", { class: "badge count" + (state.pending > lastPending ? " pop" : ""), title: "Mensajes pendientes de revisar" }, String(state.pending))
      : null;
    navEl.append(h("a", { href: item.href || agentPath(item.key), class: on ? "active" : null, "aria-current": on ? "page" : null,
      target: item.external ? "_blank" : null, rel: item.external ? "noopener" : null,
      title: item.external ? "Referencia de la API (se abre en otra pestaña)" : null },
    icon(item.icon), item.label, badge, item.external ? icon("external", "ext") : null));
  }
  lastPending = state.pending;
  placePill(pill);
}

// El indicador de la sección activa se desliza desde donde estaba
function placePill(pill) {
  const a = navEl.querySelector("a.active");
  if (!a) { pill.style.opacity = "0"; pillPos = null; return; }
  const top = a.offsetTop, ht = a.offsetHeight;
  if (pillPos && pillPos.top !== top && !reducedMotion()) {
    pill.style.transform = `translateY(${pillPos.top}px)`;
    pill.style.height = pillPos.ht + "px";
    pill.getBoundingClientRect(); // aplica la posición de partida antes de animar
    pill.classList.add("anim");
  }
  pill.style.transform = `translateY(${top}px)`;
  pill.style.height = ht + "px";
  pillPos = { top, ht };
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
    simulator.reset(true);
  }
  const section = path.startsWith("a/") ? path.split("/")[2] : path;
  renderAgentSwitch();
  renderNav(section);
  topTitle.textContent = state.agent ? state.agent.name : "Agentes";
  setPageTitle(SECTION_TITLES[section], state.agent && state.agent.name);
  if (current && current.destroy) current.destroy();
  current = null;
  currentHash = location.hash;
  clear(pageEl);
  mainEl.scrollTop = 0;
  // Cada página se dibuja en su propio contenedor: si el usuario cambia de página
  // antes de que termine de cargar, lo que llegue tarde no se mezcla con la nueva.
  const host = h("div", { class: "route" });
  pageEl.append(host);
  const skel = skeletonPage();
  const timer = setTimeout(() => { if (!host.childElementCount) host.append(skel); }, 150);
  const obs = new MutationObserver(() => {
    if ([...host.children].some((c) => c !== skel)) skel.remove();
  });
  obs.observe(host, { childList: true });
  try {
    current = (await mod.render(host, params, query)) || null;
  } catch (e) {
    console.error(e);
    host.append(h("div", { class: "page" }, h("div", { class: "notice danger" }, icon("alert"), "Error al cargar la página: " + e.message)));
  } finally {
    clearTimeout(timer);
    skel.remove();
    obs.disconnect();
  }
}

async function login() {
  const input = h("input", { type: "password", placeholder: "Token de administración", "aria-label": "Token de administración" });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.closest(".modal").querySelector(".btn.primary").click(); });
  const token = await modal({
    title: "Acceso a " + APP_NAME,
    body: [
      h("div", { class: "row", style: { gap: "12px" } }, logo("logo"),
        h("p", { class: "muted", style: { margin: 0 } }, "Este servidor está protegido. Escribe el token de administración (variable AGENTE_ADMIN_TOKEN).")),
      input],
    actions: [{ label: "Entrar", primary: true, value: () => input.value.trim() }],
  });
  setToken(token || "");
}

async function start() {
  initTooltips();
  syncThemeColor();
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
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncThemeColor);
  document.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === "s" && current && current.save) {
      e.preventDefault();
      current.save();
    } else if ((e.ctrlKey || e.metaKey) && key === "k") {
      e.preventDefault();
      openPalette();
    }
  });
  route();
}

start();
