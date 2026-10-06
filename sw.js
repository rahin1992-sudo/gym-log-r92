const CACHE = "bts-lift-v20";
const ASSETS = [
  "./", "./index.html", "./styles.css?v=20", "./program-state.js?v=20", "./app.js?v=20",
  "./program.json", "./program-min-max-phase2.json", "./pain.json",
  "./manifest.webmanifest", "./icon-180.png", "./icon-192.png", "./icon-512.png",
];
const STATIC_URLS = new Set(ASSETS.map((path) => new URL(path, self.registration.scope).href));

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith("bts-lift-") && key !== CACHE).map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  url.hash = "";
  if (event.request.method !== "GET" || !STATIC_URLS.has(url.href)) return;
  // Only the static app shell belongs in the offline cache. Backup APIs stay live.
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(url.href);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(event.request, response.clone());
    return response;
  }));
});
