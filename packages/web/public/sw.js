// Service worker for offline shell support and caching.
const CACHE_NAME = "juet-portal-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache API proxy traffic - live portal calls only
  if (url.pathname.startsWith("/api")) {
    return;
  }

  // Navigation requests: Network-first, fallback to cached shell
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          const fallback = await caches.match("/");
          return fallback || caches.match("/index.html");
        })
    );
    return;
  }

  // Static assets: Stale-while-revalidate for fast loads and offline resilience
  if (
    url.origin === location.origin &&
    (url.pathname.startsWith("/assets/") ||
     url.pathname.endsWith(".js") ||
     url.pathname.endsWith(".css") ||
     url.pathname.endsWith(".png") ||
     url.pathname.endsWith(".svg") ||
     url.pathname.endsWith(".webmanifest"))
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse.status === 200) {
              const clone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return networkResponse;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});
