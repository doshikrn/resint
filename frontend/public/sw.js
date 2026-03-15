// RESINT Service Worker — conservative, cache-first for static assets only.
// Does NOT cache API responses (existing IndexedDB layer handles offline data).

const CACHE_NAME = "resint-sw-v2";
const PRECACHE_URLS = ["/offline.html"];

// --- Install: precache offline fallback ---
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// --- Activate: clean up old caches ---
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("resint-sw-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// --- Fetch strategy ---
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache API calls — the app has its own IndexedDB offline layer
  if (url.pathname.startsWith("/api/")) return;

  // Navigation requests: network-first, offline fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html"))
    );
    return;
  }

  // Static assets (Next.js chunks, fonts, icons): cache-first
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            // Build changed — purge all stale cached chunks so a reload fetches fresh assets
            if (response.status === 404 && url.pathname.startsWith("/_next/static/")) {
              caches.open(CACHE_NAME).then((cache) =>
                cache.keys().then((keys) =>
                  keys.forEach((req) => {
                    if (new URL(req.url).pathname.startsWith("/_next/static/")) {
                      cache.delete(req);
                    }
                  })
                )
              );
              return response;
            }
            // Only cache successful responses
            if (!response || response.status !== 200 || response.type !== "basic") {
              return response;
            }
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            return response;
          })
      )
    );
    return;
  }

  // Everything else: network only (don't interfere)
});

// --- Message handler: purge caches on demand (triggered by client-version.ts on deploy) ---
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "PURGE_CACHES") {
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith("resint-sw-")).map((key) => caches.delete(key))
        )
      )
      .then(() => {
        // Re-precache essentials after purge
        caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS));
      });
  }
});

function isStaticAsset(url) {
  const p = url.pathname;
  // Next.js hashed chunks & static media (skip dev-mode paths — URLs collide across restarts)
  if (p.startsWith("/_next/static/") && !p.startsWith("/_next/static/development/")) return true;
  // App icons
  if (p.startsWith("/icons/")) return true;
  // Brand assets
  if (p.startsWith("/brand/")) return true;
  // Font files
  if (/\.(woff2?|ttf|otf)$/i.test(p)) return true;
  return false;
}
