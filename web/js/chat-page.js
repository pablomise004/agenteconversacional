// Página de chat (/chat?agent=…): el widget a pantalla completa, con «Volver» y el cambio de tema
// (dentro de un iframe de otra web no salen). El tema lo decide el <head> de chat.html: ?theme=
// (light, dark o auto); si no, el elegido en Lince (agente.theme, el mismo de la consola); si no, el
// del sistema. No es un módulo de la consola: script clásico, sin dependencias.
(function () {
  "use strict";
  var params = new URLSearchParams(location.search);
  var agent = params.get("agent");
  var root = document.documentElement;
  var themeBtn = document.getElementById("theme");
  var back = document.getElementById("back");
  var system = window.matchMedia("(prefers-color-scheme: dark)");

  function isDark() {
    return root.dataset.theme ? root.dataset.theme === "dark" : system.matches;
  }
  function syncThemeColor() {
    document.querySelector('meta[name="theme-color"]').setAttribute("content", isDark() ? "#111111" : "#eef0f6");
  }
  syncThemeColor();
  system.addEventListener("change", syncThemeColor);

  function fail(msg) {
    var d = document.createElement("div");
    d.className = "error";
    d.setAttribute("role", "alert");
    d.textContent = msg;
    document.getElementById("chat").replaceWith(d);
  }

  // Volver: a la página de antes si era de Lince (la consola, la portada); si no, a la portada
  back.addEventListener("click", function (e) {
    var fromHere = false;
    try { fromHere = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch (err) { /* nada */ }
    if (fromHere && history.length > 1) {
      e.preventDefault();
      history.back();
    }
  });

  // Tema: se guarda como el de la consola y la dirección deja de forzarlo (al recargar se queda)
  function setTheme(next) {
    root.dataset.theme = next;
    try { localStorage.setItem("agente.theme", next); } catch (err) { /* sin almacenamiento local */ }
    if (params.has("theme")) {
      params.delete("theme");
      history.replaceState(history.state, "", location.pathname + "?" + params.toString() + location.hash);
    }
    var host = document.querySelector("[data-agente-widget]");
    if (host) host.setAttribute("data-agente-theme", next);
    syncThemeColor();
  }
  themeBtn.addEventListener("click", function () {
    var next = isDark() ? "light" : "dark";
    var apply = function () { setTheme(next); };
    if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { apply(); return; }
    // el tema nuevo aparece en un círculo que crece desde el botón, como en la consola
    var r = themeBtn.getBoundingClientRect();
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    var radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.startViewTransition(apply).ready.then(function () {
      root.animate({ clipPath: ["circle(0px at " + x + "px " + y + "px)", "circle(" + radius + "px at " + x + "px " + y + "px)"] },
        { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)", pseudoElement: "::view-transition-new(root)" });
    }).catch(function () { /* sin animación */ });
  });

  if (!agent) { fail("Falta el parámetro ?agent= en la dirección."); return; }
  fetch("/api/agents/" + encodeURIComponent(agent) + "/public")
    .then(function (r) { if (!r.ok) throw new Error("No existe el agente «" + agent + "»."); return r.json(); })
    .then(function (info) {
      document.title = info.name + " · Lince";
      root.lang = info.language;
      var s = document.createElement("script");
      s.src = "/widget.js";
      s.dataset.agent = info.id;
      s.dataset.inline = "#chat";
      s.dataset.title = params.get("title") || info.name;
      s.dataset.theme = root.dataset.theme || "auto";
      if (params.get("color")) s.dataset.color = params.get("color");
      if (params.get("key")) s.dataset.key = params.get("key");
      if (info.language === "en") s.dataset.placeholder = "Type a message…";
      document.body.appendChild(s);
    })
    .catch(function (e) { fail(e.message); });
})();
