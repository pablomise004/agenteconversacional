// Service worker de Lince. Solo hace una cosa: si al abrir una página no hay conexión con el servidor,
// enseña offline.html (qué pasa y cómo arreglarlo) en vez del error del navegador. No guarda la consola
// ni los datos: con conexión todo llega del servidor, así que tras actualizarlo nunca se ve nada viejo.
// Al cambiar offline.html, sube el número de CACHE para que se guarde la nueva.
const CACHE = "lince-sin-conexion-1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([OFFLINE, "/favicon.svg"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method === "GET" && new URL(request.url).pathname === "/favicon.svg") {
    // el logotipo de la página sin conexión
    event.respondWith(fetch(request).catch(() => caches.match("/favicon.svg")));
  } else if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE)));
  }
  // lo demás (JS, CSS, la API…) va directo al servidor, sin pasar por aquí
});
