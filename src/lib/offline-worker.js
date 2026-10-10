/* Static resources only. No API, token, document, photo, session or IndexedDB
 * data enters these caches. Old builds stay usable until their tabs close. */
const CACHE_NAME = "__HVM_CACHE_NAME__";
const VERSION = __HVM_PWA_VERSION__;
const CACHE_PREFIX = "hvm-rural-assets-";
const votes = new Map();
let transition = false;
const nonce = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
const digest = async (buffer) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
const windows = () =>
  self.clients.matchAll({ type: "window", includeUncontrolled: true });
const broadcast = async (message) => {
  for (const client of await windows()) client.postMessage(message);
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      let next = 0;
      let failed = false;
      const results = await Promise.allSettled(
        Array.from({ length: 3 }, async () => {
          while (!failed && next < VERSION.resources.length) {
            const resource = VERSION.resources[next++];
            try {
              const response = await fetch(resource.url, {
                cache: "no-store",
                credentials: "omit",
                redirect: "error",
                signal: AbortSignal.timeout(60000),
              });
              if (
                !response.ok ||
                response.type === "opaque" ||
                response.redirected
              )
                throw Error("PWA_ASSET_UNAVAILABLE");
              const content = await response.clone().arrayBuffer();
              if (
                content.byteLength !== resource.bytes ||
                (await digest(content)) !== resource.sha256
              )
                throw Error("PWA_ASSET_INTEGRITY_FAILED");
              await cache.put(resource.url, response);
            } catch (error) {
              failed = true;
              throw error;
            }
          }
        }),
      );
      if (
        results.some((result) => result.status === "rejected") ||
        !(
          await Promise.all(VERSION.resources.map((r) => cache.match(r.url)))
        ).every(Boolean)
      ) {
        // All concurrent writes settled; only this failed candidate is removed.
        await caches.delete(CACHE_NAME);
        await broadcast({
          type: "HVM_PREPARATION_FAILED",
          buildId: VERSION.buildId,
        });
        throw Error("PWA_PREPARATION_FAILED");
      }
      // No skipWaiting here. Installation never interrupts a running client.
    })(),
  );
});

function queryClients(clients, token, type) {
  if (!clients.length) return Promise.resolve([]);
  return new Promise((resolve) => {
    const answers = new Map();
    const timer = setTimeout(() => {
      votes.delete(token);
      resolve(null);
    }, 4000);
    votes.set(token, {
      ids: new Set(clients.map((c) => c.id)),
      answer(id, message) {
        if (!this.ids.has(id)) return;
        answers.set(id, message);
        if (answers.size === this.ids.size) {
          clearTimeout(timer);
          votes.delete(token);
          resolve([...answers.values()]);
        }
      },
    });
    for (const client of clients)
      client.postMessage({ type, token, buildId: VERSION.buildId });
  });
}
async function cleanCaches() {
  const clients = await windows();
  const answers = await queryClients(clients, nonce(), "HVM_BUILD_QUERY");
  // A suspended/legacy tab may still need any old build. Fail closed.
  if (
    !answers ||
    answers.some((answer) => !/^[a-f0-9]{64}$/.test(answer.buildId || ""))
  )
    return;
  const keys = (await caches.keys()).filter((key) =>
    key.startsWith(CACHE_PREFIX),
  );
  const needed = new Set([
    CACHE_NAME,
    ...answers.map((answer) => CACHE_PREFIX + answer.buildId),
  ]);
  const previous = keys.filter((key) => key !== CACHE_NAME).at(-1);
  if (previous) needed.add(previous);
  for (const key of keys) if (!needed.has(key)) await caches.delete(key);
  return answers;
}
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await broadcast({
        type: "HVM_UPDATE_ACTIVATED",
        buildId: VERSION.buildId,
      }).catch(() => {});
      const identifiedClients = await cleanCaches().catch(() => null);
      // First registration can enable offline immediately without a reload.
      // Claim only when EVERY client already executes this exact shell build.
      // Missing/legacy/suspended or mixed-version clients are never claimed.
      if (
        identifiedClients &&
        identifiedClients.every((client) => client.buildId === VERSION.buildId)
      )
        await self.clients.claim().catch(() => {});
    })(),
  );
});

async function prepareUpdate(source, token) {
  if (transition) {
    source.postMessage({
      type: "HVM_UPDATE_DEFERRED",
      token,
      reason: "Outra aba está preparando a atualização.",
    });
    return;
  }
  transition = true;
  try {
    const clients = await windows();
    const ready = await queryClients(clients, token, "HVM_PREPARE_UPDATE");
    if (!ready || ready.some((answer) => !answer.safe))
      throw Error(
        ready?.find((answer) => !answer.safe)?.reason ||
          "A atualização aguarda uma aba aberta ou suspensa.",
      );
    const current = await windows();
    if (
      current.length !== clients.length ||
      current.some((client) => !clients.some((c) => c.id === client.id))
    )
      throw Error(
        "Uma aba foi aberta. A atualização aguardará um momento seguro.",
      );
    const confirmed = await queryClients(
      current,
      token + ":commit",
      "HVM_COMMIT_UPDATE",
    );
    if (!confirmed || confirmed.some((answer) => !answer.safe))
      throw Error("A atividade mudou em outra aba. A atualização foi adiada.");
    await self.skipWaiting();
  } catch (error) {
    await broadcast({ type: "HVM_ABORT_UPDATE", token });
    source.postMessage({
      type: "HVM_UPDATE_DEFERRED",
      token,
      reason: error.message,
    });
  } finally {
    transition = false;
  }
}
self.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || !event.source) return;
  if (message.type === "HVM_CLIENT_VOTE") {
    votes.get(message.token)?.answer(event.source.id, message);
    return;
  }
  if (message.type === "HVM_GET_VERSION") {
    event.ports[0]?.postMessage(VERSION);
    return;
  }
  if (
    message.type === "HVM_REQUEST_UPDATE" &&
    typeof message.token === "string"
  )
    event.waitUntil(prepareUpdate(event.source, message.token));
  if (message.type === "HVM_CLEAN_CACHES") event.waitUntil(cleanCaches());
});

const privatePath = (path) =>
  /^\/(?:api|_hvm_api|downloads|native-downloads)(?:\/|$)/.test(path);
self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    privatePath(url.pathname) ||
    request.headers.has("Authorization") ||
    url.pathname === "/pwa-version.json" ||
    url.pathname === "/offline-worker.js"
  )
    return;
  if (request.mode === "navigate") {
    event.respondWith(
      caches
        .open(CACHE_NAME)
        .then(
          async (cache) => (await cache.match("/index.html")) || fetch(request),
        ),
    );
    return;
  }
  const known = VERSION.resources.some(
    (resource) => resource.url === url.pathname,
  );
  const hashedAsset = /^\/assets\/[^/]+-[a-zA-Z0-9_-]+\.(?:js|css)$/.test(
    url.pathname,
  );
  if (!known && !hashedAsset) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(url.pathname);
      if (hit) return hit;
      // Older tabs lazy-load their own hashed chunks from retained builds.
      if (hashedAsset) {
        for (const key of (await caches.keys()).filter((key) =>
          key.startsWith(CACHE_PREFIX),
        )) {
          const previous = await (await caches.open(key)).match(url.pathname);
          if (previous) return previous;
        }
      }
      const response = await fetch(request);
      if (
        hashedAsset &&
        (!response.ok ||
          /text\/html/i.test(response.headers.get("content-type") || ""))
      )
        return Response.error();
      return response;
    })(),
  );
});
