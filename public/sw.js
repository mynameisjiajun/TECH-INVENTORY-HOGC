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

// Push notification handler
self.addEventListener("push", (event) => {
  let data = { title: "Tech Inventory", body: "You have a new notification" };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Tech Inventory", {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag || "general",
      data: { url: data.url || "/dashboard" },
    })
  );
});

// Notification click handler
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && "focus" in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
