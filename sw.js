// =============================================================
// Service Worker de ROMOR — permite instalar la app y que cargue
// aunque no haya internet (el "cascarón" de la app: HTML/CSS/JS,
// el logo y las fuentes/librerías que ya se hayan cargado antes).
//
// IMPORTANTE: esto NO cachea las llamadas a Supabase (datos, login,
// subida de archivos) — esas siempre van directo a la red. Si no
// hay internet, esas peticiones fallan normal y es la app (js/main.js)
// la que decide qué hacer (guardar en cola local, avisar, etc.).
// =============================================================
const CACHE_VERSION = "romor-v1";
const CORE_ASSETS = [
  "./",
  "index.html",
  "manifest.json",
  "js/config.js",
  "js/supabaseClient.js",
  "js/data.js",
  "js/main.js",
  "assets/logo.png",
  "assets/favicon-16.png",
  "assets/favicon-32.png",
  "assets/favicon-48.png",
  "assets/favicon-192.png",
  "assets/favicon-512.png",
  "assets/apple-touch-icon.png",
];

// Hosts externos que sí vale la pena cachear para que la app se vea/funcione
// igual sin internet (una vez que se cargaron con éxito al menos una vez).
// Deliberadamente NO incluye el dominio de Supabase — esas peticiones deben
// ir siempre a la red, nunca servirse desde caché.
const CDN_HOSTS = ["cdn.tailwindcss.com", "fonts.googleapis.com", "fonts.gstatic.com", "unpkg.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // nunca interceptar POST/PATCH/DELETE (esas son las de Supabase)

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCdn = CDN_HOSTS.includes(url.host);

  if (!isSameOrigin && !isCdn) return; // deja pasar todo lo demás (Supabase, etc.) directo a la red

  if (isCdn) {
    // Librerías/fuentes externas: sirve de caché al instante si existe, y en
    // paralelo va a la red a refrescar la copia para la próxima vez.
    event.respondWith(
      caches.open(CACHE_VERSION).then((cache) =>
        cache.match(req).then((cached) => {
          const network = fetch(req)
            .then((res) => {
              if (res && res.ok) cache.put(req, res.clone());
              return res;
            })
            .catch(() => cached);
          return cached || network;
        })
      )
    );
    return;
  }

  // Archivos propios de la app: primero intenta la red (para tener siempre
  // la versión más nueva), y si no hay internet, cae a la copia en caché.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match("index.html")))
  );
});
