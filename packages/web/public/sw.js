// Service worker for offline shell support and caching.
const CACHE_NAME = "juet-portal-v1";
// Vite changes these URLs whenever their contents change. Unversioned public
// files (icons, manifest, etc.) must still revalidate in the background.
const HASHED_ASSET = /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.[^/]+$/;

function storeResponse(request, response) {
  if (!response || response.status !== 200) return;
  const copy = response.clone();
  return caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
}

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
  if (url.pathname.startsWith("/api") || event.request.method !== "GET") {
    return;
  }

  // Navigation requests: Network-first, fallback to cached shell
  if (event.request.mode === "navigate") {
    const network = fetch(event.request);
    // Cache writes must survive response delivery, but storage failures must
    // never turn a successful network response into a failed page load.
    event.waitUntil(network.then((response) => storeResponse(event.request, response)).catch(() => {}));
    event.respondWith(
      network
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          const fallback = await caches.match("/");
          return fallback || await caches.match("/index.html") || Response.error();
        })
    );
    return;
  }

  // Hashed build assets: cache-first. Other static files: stale-while-revalidate.
  if (
    url.origin === location.origin &&
    (url.pathname.startsWith("/assets/") ||
     url.pathname.endsWith(".js") ||
     url.pathname.endsWith(".css") ||
     url.pathname.endsWith(".png") ||
     url.pathname.endsWith(".svg") ||
     url.pathname.endsWith(".webmanifest"))
  ) {
    const cached = caches.match(event.request).catch(() => undefined);
    const network = cached.then((hit) => {
      if (hit && HASHED_ASSET.test(url.pathname)) return undefined;
      return fetch(event.request).catch(() => undefined);
    });
    event.waitUntil(network.then((response) => storeResponse(event.request, response)).catch(() => {}));
    event.respondWith(cached.then((hit) => hit || network.then((response) => response || Response.error())));
  }
});
