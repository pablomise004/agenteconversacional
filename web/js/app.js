// Consola: estado global, enrutado por #hash y estructura de la página.
import { api, ml, getToken, setToken, getSpaceKey, getUser, setSpace } from "./api.js";
import {
  h, icon, logo, avatar, clear, toast, errorToast, modal, confirmDialog, closePopover, popover, optionList,
  initTooltips, skeletonPage, reducedMotion, syncThemeColor, themeButton,
} from "./ui.js";
import { createSimulator } from "./simulator.js";
import { signInPage, userButton } from "./account.js";
import { versionButton } from "./notes.js";
import * as agentsPage from "./pages/agents.js";

export const APP_NAME = "Lince";
// Versión de la consola; debe coincidir con app/__init__.py (lo comprueba tests/test_api.py)
export const APP_VERSION = "0.13.0";

export const state = {
  info: null,
  user: "",  // servidores con cuentas: quién ha entrado
  agents: [],
  agent: null,
  pending: 0,
  mode: "agents",  // «agents» (chatbots) o «ml» (machine learning, las rutas ml/… y p/…)
  projects: [],
  project: null,  // el proyecto de machine learning abierto
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
  { key: "share", label: "Compartir", icon: "share", accounts: true },  // solo en servidores con cuentas
  { key: "settings", label: "Ajustes", icon: "settings" },
  { group: "Ayuda" },
  { key: "guide", label: "Guía", icon: "book" },
  { key: "inside", label: "Por dentro", icon: "cpu" },
  { href: "/docs", label: "API", icon: "code", external: true },
];

// Secciones de un proyecto de machine learning: los datos, entrenar y usar el modelo
export const ML_NAV = [
  { group: "Datos" },
  { key: "data", label: "Datos", icon: "table" },
  { group: "Entrenar" },
  { key: "train", label: "Entrenar", icon: "flask" },
  { key: "models", label: "Modelos", icon: "chart" },
  { group: "Usar" },
  { key: "predict", label: "Probar", icon: "target" },
  { key: "api", label: "API", icon: "plug" },
  { group: "Ayuda" },
  { key: "guide", label: "Guía", icon: "book" },
  { key: "inside", label: "Por dentro", icon: "cpu" },
];

const SECTION_TITLES = Object.fromEntries([...NAV.filter((n) => n.key).map((n) => [n.key, n.label]), ["agents", "Agentes"],
  ["shared", "Agente compartido"], ["ml", "Machine learning"],
  ["data", "Datos"], ["train", "Entrenar"], ["jobs", "Entrenamiento"], ["models", "Modelos"], ["predict", "Probar"]]);

// Cada página se descarga la primera vez que se abre: al entrar solo hace falta la lista de agentes
// (y «Por dentro», la más pesada, solo llega a quien la visita)
const ROUTES = [
  [/^agents$/, () => agentsPage],
  [/^shared\/([^/]+)$/, () => import("./pages/shared.js")],
  [/^guide$/, () => import("./pages/guide.js")],
  [/^a\/([^/]+)\/guide$/, () => import("./pages/guide.js")],
  [/^inside$/, () => import("./pages/inside.js")],
  [/^a\/([^/]+)\/inside$/, () => import("./pages/inside.js")],
  [/^a\/([^/]+)\/learn$/, () => import("./pages/learn.js")],
  [/^a\/([^/]+)\/intents$/, () => import("./pages/intents.js")],
  [/^a\/([^/]+)\/intents\/([^/]+)$/, () => import("./pages/intent-editor.js")],
  [/^a\/([^/]+)\/entities$/, () => import("./pages/entities.js")],
  [/^a\/([^/]+)\/entities\/([^/]+)$/, () => import("./pages/entities.js")],
  [/^a\/([^/]+)\/analyzer$/, () => import("./pages/analyzer.js")],
  [/^a\/([^/]+)\/training$/, () => import("./pages/training.js")],
  [/^a\/([^/]+)\/history$/, () => import("./pages/history.js")],
  [/^a\/([^/]+)\/history\/(.+)$/, () => import("./pages/history.js")],
  [/^a\/([^/]+)\/integrations$/, () => import("./pages/integrations.js")],
  [/^a\/([^/]+)\/settings$/, () => import("./pages/settings.js")],
  [/^a\/([^/]+)\/share$/, () => import("./pages/share.js")],
  // machine learning
  [/^ml$/, () => import("./pages/ml-home.js")],
  [/^ml\/inside$/, () => import("./pages/ml-inside.js")],
  [/^ml\/guide$/, () => import("./pages/guide.js")],
  [/^p\/([^/]+)\/inside$/, () => import("./pages/ml-inside.js")],
  [/^p\/([^/]+)\/guide$/, () => import("./pages/guide.js")],
  [/^p\/([^/]+)\/data$/, () => import("./pages/ml-data.js")],
  [/^p\/([^/]+)\/train$/, () => import("./pages/ml-train.js")],
  [/^p\/([^/]+)\/jobs\/([^/]+)$/, () => import("./pages/ml-job.js")],
  [/^p\/([^/]+)\/models$/, () => import("./pages/ml-models.js")],
  [/^p\/([^/]+)\/models\/([^/]+)$/, () => import("./pages/ml-model.js")],
  [/^p\/([^/]+)\/predict$/, () => import("./pages/ml-predict.js")],
  [/^p\/([^/]+)\/api$/, () => import("./pages/ml-api.js")],
];

// La paleta (Ctrl+K) no hace falta para empezar: se descarga en segundo plano en cuanto la consola está
// lista y, desde entonces, se abre al momento (sin perder lo que se teclee justo después de Ctrl+K)
let palette = null;
const loadPalette = () => import("./palette.js").then((m) => (palette = m));
function openPalette() {
  if (palette) palette.openPalette();
  else loadPalette().then((m) => m.openPalette(), errorToast);
}

let root, sidebar, mainEl, pageEl, simulator, navEl, topTitle, agentBtn, modeEl;
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

export function projectPath(sub = "") {
  return `#/p/${encodeURIComponent(state.project ? state.project.id : "")}${sub ? "/" + sub : ""}`;
}

export async function refreshProjects() {
  try { state.projects = await ml.projects(); } catch (e) { state.projects = []; }
  renderAgentSwitch();
  return state.projects;
}

/** Vuelve a leer el proyecto abierto (tras entrenar, publicar o cambiar los datos). */
export async function reloadProject() {
  if (!state.project) return null;
  state.project = await ml.project(state.project.id);
  renderAgentSwitch();
  return state.project;
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
// La portada de la web pública (index.html) va fuera de #app: al montar la consola se quita
function removeLanding() {
  const landing = document.getElementById("landing");
  if (landing) landing.remove();
}

function buildLayout() {
  removeLanding();
  root = document.getElementById("app");
  clear(root);
  navEl = h("nav", { class: "nav", "aria-label": "Secciones" });
  agentBtn = h("button", { class: "agent-switch", type: "button", "aria-haspopup": "listbox", "aria-expanded": "false",
    title: "Cambiar de agente", onclick: () => (state.mode === "ml" ? openProjectMenu() : openAgentMenu()) });
  modeEl = h("nav", { class: "mode-switch", "aria-label": "Qué quieres hacer" },
    h("a", { href: "#/agents", class: "mode-btn", dataset: { mode: "agents" } }, icon("chat"), h("span", null, "Chatbots")),
    h("a", { href: "#/ml", class: "mode-btn", dataset: { mode: "ml" } }, icon("chart"), h("span", null, "Machine learning")));
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  sidebar = h("aside", { class: "sidebar" },
    h("a", { class: "brand", href: "#/agents", "aria-label": APP_NAME + ": todos los agentes" }, logo(),
      h("div", null, h("div", { class: "brand-name" }, APP_NAME), h("div", { class: "brand-sub" }, "Chatbots y machine learning"))),
    modeEl,
    agentBtn,
    h("button", { class: "search-btn", type: "button", onclick: () => openPalette(), "aria-label": "Buscar y saltar a cualquier sitio" },
      icon("search"), h("span", null, "Buscar…"), h("kbd", null, isMac ? "⌘ K" : "Ctrl K")),
    navEl,
    h("div", { class: "sidebar-foot" },
      themeButton(),
      state.info && state.info.accounts ? userButton()
        : h("a", { class: "btn ghost sm", href: "#/agents", title: "Todos los agentes" }, icon("layers"), "Agentes"),
      h("span", { class: "spacer" }),
      state.info ? versionButton(state.info.version) : null));
  topTitle = h("span", { class: "title grow ellipsis" }, "");
  const topbar = h("div", { class: "topbar" },
    h("button", { class: "btn ghost icon-only", type: "button", "aria-label": "Menú",
      onclick: (e) => { e.stopPropagation(); root.classList.toggle("menu-open"); } }, icon("menu")),
    logo(), topTitle,
    h("button", { class: "btn ghost icon-only", type: "button", "aria-label": "Buscar", onclick: () => openPalette() }, icon("search")),
    h("button", { class: "btn ghost icon-only sim-open", type: "button", "aria-label": "Probar el agente", onclick: () => setSimOpen(true) }, icon("chat")));
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

function renderMode() {
  if (!modeEl) return;
  modeEl.querySelectorAll(".mode-btn").forEach((a) => {
    const on = a.dataset.mode === state.mode;
    a.classList.toggle("on", on);
    if (on) a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
  });
  root.classList.toggle("ml-mode", state.mode === "ml");
}

const KIND_META = (p) => (p.kind === "images"
  ? `Imágenes · ${(p.data && p.data.count) || 0}`
  : p.data ? `Tabla · ${p.data.rows} filas` : "Tabla · sin datos");

function renderProjectSwitch() {
  clear(agentBtn);
  agentBtn.title = "Cambiar de proyecto";
  const p = state.project;
  if (p) {
    agentBtn.append(avatar(p.name), h("span", { class: "grow" }, h("div", { class: "name ellipsis" }, p.name),
      h("div", { class: "meta ellipsis" }, KIND_META(p))), icon("chevUpDown"));
  } else {
    const n = state.projects.length;
    agentBtn.append(h("span", { class: "avatar", style: { "--av1": "#a1a1aa", "--av2": "#71717a" } }, icon("chart")),
      h("span", { class: "grow" }, h("div", { class: "name" }, "Elige un proyecto"),
        h("div", { class: "meta ellipsis" }, n ? `${n} ${n === 1 ? "proyecto" : "proyectos"}` : "Machine learning")),
      icon("chevUpDown"));
  }
}

function openProjectMenu() {
  const option = (p) => ({ label: p.name, value: p.id, avatar: p.name, sub: KIND_META(p),
    selected: !!state.project && p.id === state.project.id });
  popover(agentBtn, h("div", { class: "agent-menu" },
    state.projects.length
      ? optionList({ groups: [{ title: "Tus proyectos", options: state.projects.map(option) }], placeholder: "Buscar proyecto…",
        onPick: (id) => { closePopover(); navigate(`#/p/${encodeURIComponent(id)}/data`); } })
      : h("div", { class: "muted small", style: { padding: "10px 12px" } }, "Todavía no tienes proyectos."),
    h("div", { class: "pop-sep" }),
    h("button", { class: "opt", type: "button", onclick: () => { closePopover(); navigate("#/ml"); } }, icon("layers"), "Ver todos los proyectos"),
    h("button", { class: "opt", type: "button", onclick: () => { closePopover(); navigate("#/ml?nuevo=1"); } }, icon("plus"), "Nuevo proyecto…")),
  { width: agentBtn.offsetWidth });
}

function renderAgentSwitch() {
  renderMode();
  if (state.mode === "ml") { renderProjectSwitch(); return; }
  clear(agentBtn);
  agentBtn.title = "Cambiar de agente";
  const a = state.agent;
  if (a) {
    agentBtn.append(avatar(a.name),
      h("span", { class: "grow" }, h("div", { class: "name ellipsis" }, a.name),
        h("div", { class: "meta ellipsis" }, `${a.intents.length} intenciones · ${(a.language || "").toUpperCase()}`)),
      icon("chevUpDown"));
  } else {
    const { mine, examples } = agentsPage.splitAgents(state.agents);
    const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    agentBtn.append(h("span", { class: "avatar", style: { "--av1": "#a1a1aa", "--av2": "#71717a" } }, icon("layers")),
      h("span", { class: "grow" }, h("div", { class: "name" }, "Elige un agente"),
        h("div", { class: "meta ellipsis" }, mine.length || !examples.length
          ? count(mine.length, "agente", "agentes") + (examples.length ? " · " + count(examples.length, "ejemplo", "ejemplos") : "")
          : count(examples.length, "ejemplo", "ejemplos"))),
      icon("chevUpDown"));
  }
}

function openAgentMenu() {
  const { mine, examples } = agentsPage.splitAgents(state.agents);
  const option = (a) => ({ label: a.name, value: a.id, avatar: a.name,
    sub: `${a.intents} ${a.intents === 1 ? "intención" : "intenciones"} · ${(a.language || "es").toUpperCase()}`,
    selected: !!state.agent && a.id === state.agent.id });
  const groups = [{ title: "Tus agentes", options: mine.map(option) }, { title: "Ejemplos", options: examples.map(option) }];
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
  const items = state.mode === "ml"
    ? (state.project ? ML_NAV.map((n) => (n.key === "data" && state.project.kind === "images" ? { ...n, icon: "image" } : n)) : [
      { key: "ml", label: "Proyectos", icon: "layers", href: "#/ml" },
      { key: "guide", label: "Guía", icon: "book", href: "#/ml/guide" },
      { key: "inside", label: "Por dentro", icon: "cpu", href: "#/ml/inside" },
      { href: "/docs", label: "API", icon: "code", external: true },
    ])
    : state.agent ? NAV : [
      { key: "agents", label: "Agentes", icon: "layers", href: "#/agents" },
      { key: "guide", label: "Guía", icon: "book", href: "#/guide" },
      { key: "inside", label: "Por dentro", icon: "cpu", href: "#/inside" },
      { href: "/docs", label: "API", icon: "code", external: true },
    ];
  for (const item of items) {
    if (item.group) { navEl.append(h("div", { class: "nav-label" }, item.group)); continue; }
    if (item.accounts && !state.info.accounts) continue;
    const on = !!item.key && active === item.key;
    const badge = item.badge && state.pending
      ? h("span", { class: "badge count" + (state.pending > lastPending ? " pop" : ""), title: "Mensajes pendientes de revisar" }, String(state.pending))
      : null;
    const href = item.href || (state.mode === "ml" ? projectPath(item.key) : agentPath(item.key));
    navEl.append(h("a", { href, class: on ? "active" : null, "aria-current": on ? "page" : null,
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
// cada navegación lleva su número: si mientras espera (el agente, la página) empieza otra, lo que
// llegue tarde de la vieja se descarta en vez de pintar encima de la nueva
let routeSeq = 0;

async function route() {
  const seq = ++routeSeq;
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
  if (!path) {  // al entrar en la consola, la lista de agentes
    navigate("#/agents");
    return;
  }
  let match = null, loader = null;
  for (const [re, load] of ROUTES) {
    match = path.match(re);
    if (match) { loader = load; break; }
  }
  if (!loader) { navigate("#/"); return; }
  // la página empieza a descargarse ya, mientras llega el agente (si falla, se dice más abajo)
  const modReady = Promise.resolve(loader());
  modReady.catch(() => {});
  const params = match.slice(1).map(decodeURIComponent);
  const isMl = path === "ml" || path.startsWith("ml/") || path.startsWith("p/");
  state.mode = isMl ? "ml" : "agents";  // la Guía y «Por dentro» de cada parte tienen su propia ruta
  if (path.startsWith("p/")) {
    let project;
    try {
      [project] = await Promise.all([ml.project(params[0]), state.projects.length ? null : refreshProjects()]);
    } catch (e) {
      if (seq !== routeSeq) return;
      errorToast(e);
      state.project = null;
      navigate("#/ml");
      return;
    }
    if (seq !== routeSeq) return;
    state.project = project;
  } else {
    state.project = null;
    if (isMl && !state.projects.length) refreshProjects();
  }
  if (isMl) {
    if (state.agent) { state.agent = null; simulator.reset(true); }
  } else if (path.startsWith("a/")) {
    const id = params[0];
    if (!state.agent || state.agent.id !== id) {
      let agent;
      try {
        agent = await api.agent(id);
      } catch (e) {
        if (seq !== routeSeq) return;
        errorToast(e);
        state.agent = null;
        navigate("#/agents");
        return;
      }
      if (seq !== routeSeq) return;
      state.agent = agent;
      simulator.reset(true);
      refreshPending();
    }
  } else {
    state.agent = null;
    simulator.reset(true);
  }
  let section = path.split("/")[path.startsWith("a/") || path.startsWith("p/") ? 2 : 0];
  if (path.startsWith("ml/")) section = path.slice(3);
  renderAgentSwitch();
  renderNav(section === "jobs" ? "train" : section);
  const owner = state.mode === "ml" ? state.project : state.agent;
  topTitle.textContent = owner ? owner.name : SECTION_TITLES[section] || (state.mode === "ml" ? "Machine learning" : "Agentes");
  setPageTitle(SECTION_TITLES[section], owner && owner.name);
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
    const mod = await modReady;
    if (seq !== routeSeq) return;  // mientras se descargaba se ha ido a otra página
    const page = (await mod.render(host, params, query)) || null;
    if (seq === routeSeq) current = page;
    else if (page && page.destroy) page.destroy();  // ya se ha ido a otra página
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

// Servidores con cuentas: con la llave guardada se comprueba que sigue valiendo; si no, a entrar.
async function ensureAccount() {
  if (getSpaceKey()) {
    try {
      state.user = (await api.account()).user || getUser();
      return;
    } catch (e) {
      if (e.status !== 401) throw e;
      setSpace("");
    }
  }
  await signInPage();
  state.user = getUser();
}

// Service worker (web/sw.js): sin conexión con el servidor enseña una página que lo explica en vez del
// error del navegador, y hace que la consola se pueda instalar como aplicación. No guarda nada más: con
// conexión todo llega del servidor, como siempre.
function registerServiceWorker() {
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* sin él, la consola funciona igual */ });
  }
}

async function start() {
  initTooltips();
  syncThemeColor();
  registerServiceWorker();
  try {
    state.info = await api.info();
  } catch (e) {
    removeLanding();
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
  if (state.info.accounts) await ensureAccount();
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
  // cuando el navegador esté desocupado (lo primero es la página que se abre)
  (window.requestIdleCallback || ((fn) => setTimeout(fn, 1500)))(() => loadPalette().catch(() => {}));
}

start();
