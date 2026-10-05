/* Vigía de Nexo: Web Vitals de visitantes reales y errores de JS, mandados al portal con sendBeacon.
   Sin cookies, sin IP guardada, sin identificar a nadie: un id aleatorio por pestaña que muere con ella.
   Uso: <script src="https://TU-NEXO/herramientas/vigia/vigia.js" data-clave="…" defer></script>
   (o copia este fichero a tu web y apunta data-ingesta a https://TU-NEXO/herramientas/vigia/ingesta). */
(function vigia() {
  'use strict';
  var script = document.currentScript;
  if (!script || !script.dataset.clave || !('sendBeacon' in navigator) || !window.PerformanceObserver) return;
  var clave = script.dataset.clave;
  var ingesta = script.dataset.ingesta || script.src.replace(/vigia\.js(\?.*)?$/, 'ingesta');

  var sesion = (function () {
    try {
      var s = sessionStorage.getItem('nexo-vigia');
      if (!s) { s = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); sessionStorage.setItem('nexo-vigia', s); }
      return s;
    } catch (e) { return 'anon'; }
  })();

  function navegador() {
    var ua = navigator.userAgent;
    var m = /(Edg|OPR|SamsungBrowser|Firefox|CriOS|Chrome|Safari)\/(\d+)/.exec(ua);
    var nombre = m ? { Edg: 'Edge', OPR: 'Opera', SamsungBrowser: 'Samsung', CriOS: 'Chrome iOS' }[m[1]] || m[1] : 'otro';
    var so = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
    return (nombre + (m ? ' ' + m[2] : '') + (so ? ' · ' + so : '')).slice(0, 60);
  }
  function comun() {
    return { clave: clave, sesion: sesion, ruta: location.pathname, disp: innerWidth < 768 ? 'movil' : 'escritorio', nav: navegador(), con: (navigator.connection && navigator.connection.effectiveType) || '' };
  }
  function enviar(datos) {
    try { navigator.sendBeacon(ingesta, new Blob([JSON.stringify(datos)], { type: 'text/plain' })); } catch (e) { /* sin red o bloqueado: nada que hacer */ }
  }
  var redondear = function (v) { return v == null ? null : Math.round(v); };

  // --- Vitales: LCP, CLS (ventanas de sesión), INP (aprox. p98 de las interacciones), FCP, TTFB ---------------
  var v = { lcp: null, cls: 0, inp: null, fcp: null, ttfb: null };
  function observar(tipo, fn, extra) {
    try {
      var o = new PerformanceObserver(function (lista) { lista.getEntries().forEach(fn); });
      var opciones = { type: tipo, buffered: true };
      if (extra) for (var k in extra) opciones[k] = extra[k];
      o.observe(opciones);
    } catch (e) { /* tipo no soportado en este navegador */ }
  }
  observar('largest-contentful-paint', function (e) { v.lcp = e.startTime; });
  observar('paint', function (e) { if (e.name === 'first-contentful-paint') v.fcp = e.startTime; });
  var clsSesion = 0; var clsPrimero = 0; var clsUltimo = 0;
  observar('layout-shift', function (e) {
    if (e.hadRecentInput) return;
    if (clsSesion && e.startTime - clsUltimo < 1000 && e.startTime - clsPrimero < 5000) clsSesion += e.value;
    else { clsSesion = e.value; clsPrimero = e.startTime; }
    clsUltimo = e.startTime;
    if (clsSesion > v.cls) v.cls = clsSesion;
  });
  var interacciones = {};
  function apuntar(e) { if (!e.interactionId) return; if (!(interacciones[e.interactionId] >= e.duration)) interacciones[e.interactionId] = e.duration; }
  observar('event', apuntar, { durationThreshold: 40 });
  observar('first-input', apuntar);
  var navegacion = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
  if (navegacion) v.ttfb = navegacion.responseStart;

  var enviado = false;
  function mandarVitales() {
    if (enviado) return;
    enviado = true;
    var duraciones = Object.keys(interacciones).map(function (k) { return interacciones[k]; }).sort(function (a, b) { return b - a; });
    v.inp = duraciones.length ? duraciones[Math.min(duraciones.length - 1, Math.floor(duraciones.length / 50))] : null;
    var datos = comun();
    datos.tipo = 'vitales';
    datos.vitales = { lcp: redondear(v.lcp), cls: Math.round(v.cls * 1000) / 1000, inp: redondear(v.inp), fcp: redondear(v.fcp), ttfb: redondear(v.ttfb) };
    datos.tipoNav = navegacion ? navegacion.type : '';
    enviar(datos);
  }
  addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') mandarVitales(); });
  addEventListener('pagehide', mandarVitales);

  // --- Errores: excepciones, promesas rechazadas y recursos que no cargan (hasta 3 veces cada uno) -----------
  var vistos = {};
  function mandarError(mensaje, fichero, linea, col, pila) {
    var k = mensaje + '|' + fichero + '|' + linea;
    vistos[k] = (vistos[k] || 0) + 1;
    if (vistos[k] > 3) return;
    var datos = comun();
    datos.tipo = 'error';
    datos.error = { mensaje: String(mensaje).slice(0, 300), fichero: String(fichero || '').slice(0, 200), linea: linea | 0, col: col | 0, pila: String(pila || '').slice(0, 1500) };
    enviar(datos);
  }
  addEventListener('error', function (e) {
    if (e.message) mandarError(e.message, e.filename, e.lineno, e.colno, e.error && e.error.stack);
    else if (e.target && e.target !== window && (e.target.src || e.target.href)) mandarError('Recurso no cargó: ' + (e.target.src || e.target.href), '', 0, 0, '');
  }, true);
  addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    mandarError('Promesa rechazada: ' + (r && r.message ? r.message : String(r)), '', 0, 0, r && r.stack);
  });
})();
