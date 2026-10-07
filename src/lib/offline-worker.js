/* Generated at build: static application assets only. Never cache APIs, private
 * responses, auth credentials or dynamic photo URLs. */
const CACHE_NAME = "__HVM_CACHE_NAME__";
const STATIC_ASSETS = __HVM_STATIC_ASSETS__;
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Bound concurrent downloads on rural connections.
      let next = 0;
      await Promise.all(
        Array.from({ length: 3 }, async () => {
          while (next < STATIC_ASSETS.length) {
            const path = STATIC_ASSETS[next++],
              response = await fetch(path, { cache: "reload" });
            if (!response.ok || response.type === "opaque")
              throw new Error("OFFLINE_ASSET_UNAVAILABLE");
            await cache.put(path, response);
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = (await caches.keys()).filter((k) =>
        k.startsWith("hvm-rural-assets-"),
      );
      // Retain one previous static build for already open tabs during an update.
      for (const key of keys.filter((k) => k !== CACHE_NAME).slice(0, -1))
        await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (/^\/assets\/[^/]+\.(?:js|css)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request)),
    );
    return;
  }
  if (
    request.mode === "navigate" &&
    (url.pathname === "/" ||
      url.pathname === "/conta" ||
      url.pathname.startsWith("/produtor/"))
  ) {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME),
          shell = await cache.match("/index.html");
        return shell || Response.error();
      }),
    );
  }
});
