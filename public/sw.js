const CACHE_NAME = "tech-inventory-v4";
const API_CACHE = "tech-inventory-api-v1";

// App shell — pages & assets to pre-cache on install
const APP_SHELL = ["/manifest.json", "/offline"];

// API routes we want to cache for offline browsing
const CACHEABLE_API = ["/api/items"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => n !== CACHE_NAME && n !== API_CACHE)
            .map((n) => caches.delete(n)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;

  // --- Cacheable API routes: network-first, fall back to cache ---
  if (CACHEABLE_API.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(API_CACHE).then((c) => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match(event.request).then(
            (cached) =>
              cached ||
              new Response(
                JSON.stringify({
                  items: [],
                  filters: { types: [], brands: [] },
                  offline: true,
                }),
                {
                  headers: { "Content-Type": "application/json" },
                },
              ),
          ),
        ),
    );
    return;
  }

  // --- Other API routes: network only ---
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // --- Pages & static assets: network-first, cache fallback, offline page ---
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return res;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then((cached) => cached || caches.match("/offline")),
      ),
  );
});
