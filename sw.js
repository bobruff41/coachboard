// CoachBoard Service Worker (strong update behavior for iOS Safari/PWA)

const VERSION = "coachboard-pro-v7"; // <-- bump this every time you deploy
const CACHE_STATIC = `${VERSION}-static`;

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./sw.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Delete old caches
    const keys = await caches.keys();
    await Promise.all(keys.map((k) =>
      (k.endsWith("-static") && k !== CACHE_STATIC) ? caches.delete(k) : null
    ));

    // Take control of pages
    await self.clients.claim();

    // Tell all open tabs to reload so they get the new assets
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: "SW_UPDATED", version: VERSION });
    }
  })());
});

// Network-first for HTML so updates show up, cache-first for static files.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isHTML =
    req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");

  if (isHTML) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_STATIC);
        cache.put("./index.html", fresh.clone()); // keep entrypoint fresh
        return fresh;
      } catch {
        return (await caches.match("./index.html")) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    const fresh = await fetch(req);
    const cache = await caches.open(CACHE_STATIC);
    cache.put(req, fresh.clone());
    return fresh;
  })());
});
