// Cuentas (servidores con AGENTE_ACCOUNTS): entrar o crear la cuenta, el botón del usuario de la
// barra lateral y cambiar la contraseña. La llave del espacio la guarda api.js y va en cada petición.
import { api, getUser, setSpace } from "./api.js";
import { h, icon, logo, avatar, modal, segmented, toast, errorToast, busy, popover, closePopover } from "./ui.js";

const field = (label, input, hint) => h("label", { class: "field" }, label, input, hint ? h("span", { class: "hint" }, hint) : null);

/** Ventana para entrar o crear la cuenta; no se cierra hasta que se entra. */
export async function signIn() {
  let mode = "login";
  let submitBtn = null;
  const user = h("input", { type: "text", autocomplete: "username", maxlength: "30", spellcheck: "false",
    autocapitalize: "none", placeholder: "Por ejemplo: lucia.garcia" });
  const pass = h("input", { type: "password", autocomplete: "current-password" });
  const pass2 = h("input", { type: "password", autocomplete: "new-password" });
  const userHint = h("span", { class: "hint", hidden: true }, "De 3 a 30 caracteres: letras sin tildes ni eñes, números, puntos o guiones.");
  const repeat = field("Repite la contraseña", pass2);
  const keep = h("p", { class: "muted small", style: { margin: 0 } },
    "Apunta tu contraseña: si la olvidas, solo quien lleva este servidor puede ponerte otra.");
  const error = h("div", { class: "notice danger", role: "alert" }, icon("alert"), h("div"));
  const show = (msg) => { error.lastChild.textContent = msg; error.hidden = false; };

  const paint = () => {
    const reg = mode === "register";
    repeat.hidden = keep.hidden = userHint.hidden = !reg;
    error.hidden = true;
    pass.autocomplete = reg ? "new-password" : "current-password";
    if (submitBtn) submitBtn.textContent = reg ? "Crear cuenta" : "Entrar";
  };
  const tabs = segmented({ items: [{ key: "login", label: "Entrar" }, { key: "register", label: "Crear cuenta" }],
    active: mode, label: "Entrar o crear una cuenta", onChange: (k) => { mode = k; paint(); user.focus(); } });

  const submit = () => busy(submitBtn, async () => {
    error.hidden = true;
    const u = user.value.trim(), p = pass.value;
    if (!u) { user.focus(); return false; }
    if (!p) { pass.focus(); return false; }
    if (mode === "register" && p !== pass2.value) { show("Las dos contraseñas no coinciden."); pass2.focus(); return false; }
    try {
      const res = mode === "register" ? await api.register(u, p) : await api.login(u, p);
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

  await modal({
    title: "Entra en Lince",
    closable: false,
    body: [
      h("div", { class: "row", style: { gap: "14px" } }, logo("logo signin-logo"),
        h("p", { class: "muted", style: { margin: 0 } }, "Cada uno tiene su cuenta: solo tú ves tus agentes, y los compartes con un enlace cuando quieras.")),
      tabs,
      h("label", { class: "field" }, "Usuario", user, userHint),
      field("Contraseña", pass),
      repeat, keep, error,
    ],
    actions: [{ label: "Entrar", primary: true, validate: submit, value: true }],
    onOpen: (box) => { submitBtn = box.querySelector(".modal-foot .btn.primary"); paint(); },
  });
  toast(mode === "register" ? `Cuenta creada. ¡Hola, ${getUser()}!` : `¡Hola, ${getUser()}!`, "success");
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

/** Botón con el usuario (barra lateral): cambiar la contraseña o salir. */
export function userButton() {
  const name = getUser();
  const btn = h("button", { class: "btn ghost sm user-btn", type: "button", title: "Tu cuenta", "aria-haspopup": "menu",
    onclick: () => popover(btn, h("div", { class: "agent-menu" },
      h("div", { class: "pop-title" }, "Has entrado como ", h("b", null, name)),
      h("button", { class: "opt", type: "button", onclick: () => { closePopover(); changePassword().catch(errorToast); } }, icon("key"), "Cambiar la contraseña…"),
      h("button", { class: "opt", type: "button", onclick: () => { closePopover(); signOut(); } }, icon("logout"), "Salir"))) },
  avatar(name, "sm"), h("span", { class: "ellipsis" }, name));
  return btn;
}
