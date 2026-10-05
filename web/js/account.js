// Cuentas (servidores con AGENTE_ACCOUNTS): entrar, crear la cuenta o entrar sin cuenta, el botón del
// usuario de la barra lateral y cambiar la contraseña. La llave del espacio la guarda api.js y va en
// cada petición. Sin cuenta, la llave solo está en este navegador (getUser() vacío).
import { api, getUser, setSpace } from "./api.js";
import { h, icon, logo, avatar, modal, toast, errorToast, busy, popover, closePopover, confirmDialog, segmented,
  themeButton } from "./ui.js";

const field = (label, input, hint) => h("label", { class: "field" }, label, input, hint ? h("span", { class: "hint" }, hint) : null);
const GUEST_NOTE = "Tus agentes solo se verán en este navegador. Para usarlos en otro ordenador, expórtalos e impórtalos allí; o crea una cuenta más tarde y se pasarán a ella.";

/** Cambia un texto con una animación corta (se repite aunque la anterior no hubiera acabado). */
function swapText(el, text) {
  if (el.textContent === text) return;
  el.textContent = text;
  el.classList.remove("swap-in");
  void el.offsetWidth;  // para que la animación vuelva a empezar
  el.classList.add("swap-in");
}

const SUB_LOGIN = "Cada uno tiene su cuenta: solo tú ves tus agentes, y los compartes con un enlace cuando quieras.";
const SUB_REGISTER = "Elige un usuario y una contraseña: no hace falta correo. Empiezas con los dos agentes de ejemplo.";

/**
 * La portada de la web pública (#landing en index.html): qué es Lince y el formulario para entrar, crear
 * la cuenta o entrar sin cuenta. Viene ya en el HTML (se pinta sin esperar al JS y la leen los buscadores);
 * aquí solo se le da vida: las pestañas con su indicador, lo que se despliega al crear la cuenta, los
 * textos que cambian y el botón del tema. Se cumple cuando se ha entrado.
 */
export function signInPage() {
  delete document.documentElement.dataset.boot;  // la llave guardada ya no valía: se enseña la portada
  const landing = document.getElementById("landing");
  const form = landing.querySelector("#signin");
  const [user, pass, pass2] = ["#signin-user", "#signin-pass", "#signin-pass2"].map((s) => form.querySelector(s));
  const submitBtn = form.querySelector(".signin-submit");
  const submitLabel = submitBtn.querySelector(".swap-label");
  const guestBtn = landing.querySelector("#signin-guest");
  const error = form.querySelector("#signin-error");
  const title = landing.querySelector("#signin-title");
  const sub = landing.querySelector("#signin-sub");
  const reveals = [...form.querySelectorAll(".reveal")];
  let mode = "login";
  const show = (msg) => { error.lastChild.textContent = msg; error.hidden = false; };

  // las pestañas del HTML pasan a ser las de la consola (segmented), con el indicador que se desliza
  const tabs = segmented({ items: [{ key: "login", label: "Entrar" }, { key: "register", label: "Crear cuenta" }],
    active: mode, label: "Entrar o crear una cuenta", onChange: (key) => { mode = key; paint(); user.focus(); } });
  tabs.classList.add("signin-tabs");
  form.querySelector(".signin-tabs").replaceWith(tabs);
  tabs.addEventListener("keydown", (e) => {  // con las flechas se pasa a la otra pestaña
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    mode = mode === "login" ? "register" : "login";
    tabs.select(mode);
    paint();
    tabs.querySelector('[aria-selected="true"]').focus();
  });

  const paint = () => {
    const reg = mode === "register";
    for (const t of tabs.querySelectorAll("[role=tab]")) t.tabIndex = t.getAttribute("aria-selected") === "true" ? 0 : -1;
    for (const r of reveals) {  // se despliega (o se recoge) y, recogido, no se llega con el tabulador
      r.classList.toggle("open", reg);
      r.inert = !reg;
    }
    if (reg) user.setAttribute("aria-describedby", "signin-user-hint");
    else user.removeAttribute("aria-describedby");
    error.hidden = true;
    pass.autocomplete = reg ? "new-password" : "current-password";
    swapText(title, reg ? "Crea tu cuenta" : "Entra en Lince");
    swapText(sub, reg ? SUB_REGISTER : SUB_LOGIN);
    swapText(submitLabel, reg ? "Crear cuenta" : "Entrar");
  };

  // claro u oscuro, arriba a la derecha (el mismo botón que en la consola)
  landing.querySelector("#landing-corner").append(themeButton("btn ghost icon-only theme-btn"));
  // quien abre un enlace compartido sin haber entrado: primero entra y luego ve el agente
  landing.querySelector("#signin-shared").hidden = !location.hash.startsWith("#/shared/");
  paint();
  return new Promise((resolve) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      busy(submitBtn, async () => {
        error.hidden = true;
        const u = user.value.trim(), p = pass.value;
        if (!u) return user.focus();
        if (!p) return pass.focus();
        if (mode === "register" && p !== pass2.value) { show("Las dos contraseñas no coinciden."); return pass2.focus(); }
        try {
          const res = mode === "register" ? await api.register(u, p) : await api.login(u, p);
          setSpace(res.spaceKey, res.user);
        } catch (err) {
          return show(err.message);
        }
        toast(mode === "register" ? `Cuenta creada. ¡Hola, ${getUser()}!` : `¡Hola, ${getUser()}!`, "success");
        resolve(true);
      }).catch(errorToast);
    });
    // sin cuenta: un espacio cuya llave solo se queda en este navegador
    guestBtn.addEventListener("click", () => busy(guestBtn, async () => {
      error.hidden = true;
      try {
        const res = await api.guest();
        setSpace(res.spaceKey, "");
      } catch (err) {
        return show(err.message);
      }
      toast("Has entrado sin cuenta: tus agentes se guardan en este navegador.", "success", 4500);
      resolve(true);
    }).catch(errorToast));
    submitBtn.disabled = guestBtn.disabled = false;  // en el HTML vienen apagados hasta que hay JS
  });
}

/**
 * Quien entró sin cuenta la crea ahora: el servidor le pasa el espacio que ya tenía, con todos sus
 * agentes. Se cumple con true si se ha creado.
 */
async function createAccount() {
  let submitBtn = null;
  const user = h("input", { type: "text", name: "username", autocomplete: "username", maxlength: "30", spellcheck: "false",
    autocapitalize: "none", placeholder: "Por ejemplo: lucia.garcia" });
  const pass = h("input", { type: "password", name: "password", autocomplete: "new-password" });
  const pass2 = h("input", { type: "password", name: "password-repeat", autocomplete: "new-password" });
  const error = h("div", { class: "notice danger", role: "alert", hidden: true }, icon("alert"), h("div"));
  const show = (msg) => { error.lastChild.textContent = msg; error.hidden = false; };
  const submit = () => busy(submitBtn, async () => {
    error.hidden = true;
    const u = user.value.trim(), p = pass.value;
    if (!u) { user.focus(); return false; }
    if (!p) { pass.focus(); return false; }
    if (p !== pass2.value) { show("Las dos contraseñas no coinciden."); pass2.focus(); return false; }
    try {
      const res = await api.register(u, p);
      setSpace(res.spaceKey, res.user);
      return true;
    } catch (e) {
      show(e.message);
      return false;
    }
  });
  for (const inp of [user, pass, pass2]) {
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submitBtn.click(); } });
  }
  const done = await modal({
    title: "Crea tu cuenta",
    body: [
      h("div", { class: "row", style: { gap: "14px" } }, logo("logo signin-logo"),
        h("p", { class: "muted", style: { margin: 0 } },
          "Tus agentes se pasan a la cuenta: podrás abrirlos desde cualquier ordenador con tu usuario y tu contraseña.")),
      field("Usuario", user, "De 3 a 30 caracteres: letras sin tildes ni eñes, números, puntos o guiones."),
      field("Contraseña", pass),
      field("Repite la contraseña", pass2),
      h("p", { class: "muted small", style: { margin: 0 } },
        "Apunta tu contraseña: si la olvidas, solo quien lleva este servidor puede ponerte otra."),
      error,
    ],
    actions: [{ label: "Cancelar", value: null }, { label: "Crear cuenta", primary: true, validate: submit, value: true }],
    onOpen: (box) => { submitBtn = box.querySelector(".modal-foot .btn.primary"); },
  });
  if (done) toast(`Cuenta creada. ¡Hola, ${getUser()}!`, "success");
  return !!done;
}

async function changePassword() {
  const current = h("input", { type: "password", autocomplete: "current-password" });
  const next = h("input", { type: "password", autocomplete: "new-password" });
  const next2 = h("input", { type: "password", autocomplete: "new-password" });
  const error = h("div", { class: "notice danger", role: "alert", hidden: true }, icon("alert"), h("div"));
  let btn = null;
  const done = await modal({
    title: "Cambiar la contraseña",
    body: [field("Contraseña actual", current), field("Contraseña nueva", next, "Al menos 6 caracteres."),
      field("Repite la nueva", next2), error],
    actions: [{ label: "Cancelar", value: null }, { label: "Cambiar", primary: true, value: true,
      validate: () => busy(btn, async () => {
        error.hidden = true;
        if (next.value !== next2.value) { error.lastChild.textContent = "Las dos contraseñas nuevas no coinciden."; error.hidden = false; return false; }
        try {
          await api.changePassword(current.value, next.value);
          return true;
        } catch (e) {
          error.lastChild.textContent = e.message;
          error.hidden = false;
          return false;
        }
      }) }],
    onOpen: (box) => { btn = box.querySelector(".modal-foot .btn.primary"); },
  });
  if (done) toast("Contraseña cambiada", "success");
}

function signOut() {
  setSpace("");
  location.hash = "#/agents";
  location.reload();
}

/** Botón con el usuario (barra lateral): cambiar la contraseña o salir. Sin cuenta, «Sin cuenta». */
export function userButton() {
  const name = getUser();
  if (!name) return guestButton();
  const btn = h("button", { class: "btn ghost sm user-btn", type: "button", title: "Tu cuenta", "aria-haspopup": "menu",
    onclick: () => popover(btn, h("div", { class: "agent-menu" },
      h("div", { class: "pop-title" }, "Has entrado como ", h("b", null, name)),
      h("button", { class: "opt", type: "button", onclick: () => { closePopover(); changePassword().catch(errorToast); } }, icon("key"), "Cambiar la contraseña…"),
      h("button", { class: "opt", type: "button", onclick: () => { closePopover(); signOut(); } }, icon("logout"), "Salir"))) },
  avatar(name, "sm"), h("span", { class: "ellipsis" }, name));
  return btn;
}

// sin cuenta: recuerda dónde están los agentes, permite crear la cuenta sin perderlos y avisa al salir
function guestButton() {
  const btn = h("button", { class: "btn ghost sm user-btn", type: "button", title: "Estás sin cuenta", "aria-haspopup": "menu",
    onclick: () => popover(btn, h("div", { class: "agent-menu" },
      h("div", { class: "pop-title" }, h("b", null, "Estás sin cuenta")),
      h("p", { class: "pop-note" }, GUEST_NOTE),
      h("button", { class: "opt", type: "button", onclick: async () => {
        closePopover();
        try { if (await createAccount()) location.reload(); } catch (e) { errorToast(e); }
      } }, icon("user"), "Crear una cuenta y guardarlos…"),
      h("button", { class: "opt", type: "button", onclick: async () => {
        closePopover();
        const ok = await confirmDialog("Sin cuenta, al salir ya no podrás volver a abrir estos agentes. Si quieres conservarlos, crea una cuenta o expórtalos antes (Ajustes → Exportar).",
          { title: "¿Salir sin cuenta?", okLabel: "Salir", danger: true });
        if (ok) signOut();
      } }, icon("logout"), "Salir…"))) },
  h("span", { class: "avatar sm guest-av" }, icon("user")), h("span", { class: "ellipsis" }, "Sin cuenta"));
  return btn;
}
