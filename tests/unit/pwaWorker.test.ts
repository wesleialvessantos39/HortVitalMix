import { readFileSync } from "node:fs";
import { createHash, webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function harness(
  options: {
    corrupt?: boolean;
    missing?: boolean;
    safe?: boolean;
    silent?: boolean;
    newTab?: boolean;
    commitUnsafe?: boolean;
    cleanupFailure?: boolean;
    oldCrypto?: boolean;
  } = {},
) {
  const body = new TextEncoder().encode("synthetic static resource");
  const resources = [
    "/index.html",
    "/manifest.webmanifest",
    "/app-icons/icon-192.png",
    "/app-icons/icon-512.png",
    "/assets/app-synthetic.js",
  ].map((url) => ({
    url,
    bytes: body.byteLength,
    sha256: createHash("sha256").update(body).digest("hex"),
  }));
  const version = { buildId: "b".repeat(64), resources };
  const events = new Map<string, (event: any) => void>();
  const stores = new Map<string, Map<string, Response>>([
    [
      "hvm-rural-assets-previous",
      new Map([["/assets/old-old.js", new Response("old")]]),
    ],
    ["private-other-app", new Map()],
  ]);
  const cacheName = "hvm-rural-assets-" + version.buildId;
  const messages: any[] = [];
  const skipWaiting = vi.fn(async () => {});
  let clientQueryCount = 0;
  const client = {
    id: "tab-1",
    postMessage(message: any) {
      messages.push(message);
      if (
        !message.token ||
        options.silent ||
        ![
          "HVM_PREPARE_UPDATE",
          "HVM_COMMIT_UPDATE",
          "HVM_BUILD_QUERY",
        ].includes(message.type)
      )
        return;
      events.get("message")?.({
        data: {
          type: "HVM_CLIENT_VOTE",
          token: message.token,
          safe:
            options.safe !== false &&
            !(message.type === "HVM_COMMIT_UPDATE" && options.commitUnsafe),
          reason: "Unsaved form",
          buildId: "a".repeat(64),
        },
        source: client,
      });
    },
  };
  const caches = {
    keys: async () => { if (options.cleanupFailure) throw Error("synthetic cleanup failure"); return [...stores.keys()]; },
    delete: vi.fn(async (name: string) => stores.delete(name)),
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        put: async (url: string, response: Response) => {
          store.set(url, response);
        },
        match: async (url: string) => store.get(url)?.clone(),
      };
    },
  };
  const fetch = vi.fn(async (url: string | Request) => {
    const path = typeof url === "string" ? url : new URL(url.url).pathname;
    if (options.missing && path === "/app-icons/icon-512.png")
      return new Response("missing", { status: 404 });
    return new Response(
      options.corrupt && path === "/index.html" ? "corrupt" : body,
    );
  });
  runInNewContext(
    readFileSync("src/lib/offline-worker.js", "utf8")
      .replace("__HVM_CACHE_NAME__", cacheName)
      .replace("__HVM_PWA_VERSION__", JSON.stringify(version)),
    {
      self: {
        location: { origin: "https://hortvitalmix.vercel.app" },
        addEventListener: (name: string, cb: any) => events.set(name, cb),
        skipWaiting,
        clients: {
          matchAll: async () => {
            clientQueryCount++;
            return options.newTab && clientQueryCount > 1
              ? [client, { id: "tab-2", postMessage() {} }]
              : [client];
          },
          claim: vi.fn(),
        },
      },
      caches,
      fetch,
      crypto: options.oldCrypto ? { subtle: webcrypto.subtle, getRandomValues: webcrypto.getRandomValues.bind(webcrypto) } : webcrypto,
      Response,
      URL,
      AbortSignal,
      Uint8Array,
      setTimeout: (cb: () => void, ms: number) =>
        setTimeout(cb, Math.min(ms, 10)),
      clearTimeout,
    },
  );
  async function dispatch(name: string, data: Record<string, unknown> = {}) {
    let pending: Promise<void> | undefined;
    events.get(name)!({
      ...data,
      waitUntil: (value: Promise<void>) => {
        pending = value;
      },
    });
    await pending;
  }
  return {
    stores,
    fetch,
    cacheName,
    caches,
    messages,
    skipWaiting,
    dispatch,
    events,
    client,
  };
}
describe("atomic static worker", () => {
  it.each([{ cleanupFailure: true }, { oldCrypto: true }])("keeps a valid worker active when optional cleanup or newer crypto APIs are unavailable: %j", async (options) => {
    const h = harness(options);
    await expect(h.dispatch("activate")).resolves.toBeUndefined();
    expect(h.stores.has("hvm-rural-assets-previous")).toBe(true);
  });
  it("prepares the entire verified set without activating or deleting older caches", async () => {
    const h = harness();
    await h.dispatch("install");
    expect(h.stores.get(h.cacheName)?.size).toBe(5);
    expect(h.skipWaiting).not.toHaveBeenCalled();
    expect(h.caches.delete).not.toHaveBeenCalled();
  });
  it.each([{ corrupt: true }, { missing: true }])(
    "rejects a damaged build and removes only its own partial cache: %j",
    async (options) => {
      const h = harness(options);
      await expect(h.dispatch("install")).rejects.toThrow(
        "PWA_PREPARATION_FAILED",
      );
      expect(h.stores.has(h.cacheName)).toBe(false);
      expect(h.stores.has("hvm-rural-assets-previous")).toBe(true);
      expect(h.stores.has("private-other-app")).toBe(true);
      expect(h.skipWaiting).not.toHaveBeenCalled();
    },
  );
  it("activates after every tab confirms both stages", async () => {
    const h = harness();
    await h.dispatch("install");
    await h.dispatch("message", {
      data: { type: "HVM_REQUEST_UPDATE", token: "vote" },
      source: h.client,
    });
    expect(h.skipWaiting).toHaveBeenCalledTimes(1);
  });
  it.each([
    { safe: false },
    { silent: true },
    { newTab: true },
    { commitUnsafe: true },
  ])("preserves the running version when a vote fails: %j", async (options) => {
    const h = harness(options);
    await h.dispatch("message", {
      data: { type: "HVM_REQUEST_UPDATE", token: "vote" },
      source: h.client,
    });
    expect(h.skipWaiting).not.toHaveBeenCalled();
    expect(
      h.messages.some((message) => message.type === "HVM_UPDATE_DEFERRED"),
    ).toBe(true);
  });
  it("keeps old caches when a suspended tab cannot identify its build", async () => {
    const h = harness({ silent: true });
    await h.dispatch("activate");
    expect(h.caches.delete).not.toHaveBeenCalled();
  });
  it.each([
    "/api/v1/admin/documents",
    "/_hvm_api/v1/orders",
    "/downloads/android",
    "/pwa-version.json",
    "/offline-worker.js",
    "/native-downloads/test.apk",
  ])("does not cache or intercept %s", (path) => {
    const h = harness();
    const respondWith = vi.fn();
    h.events.get("fetch")!({
      request: {
        method: "GET",
        url: "https://hortvitalmix.vercel.app" + path,
        mode: "navigate",
        headers: new Headers(),
      },
      respondWith,
    });
    expect(respondWith).not.toHaveBeenCalled();
  });
  it("does not serve even a static response to authenticated or foreign requests", () => {
    const h = harness();
    const respondWith = vi.fn();
    for (const request of [
      {
        method: "GET",
        url: "https://hortvitalmix.vercel.app/assets/app-synthetic.js",
        headers: new Headers({ Authorization: "Bearer synthetic" }),
      },
      {
        method: "GET",
        url: "https://foreign.test/assets/app-synthetic.js",
        headers: new Headers(),
      },
    ])
      h.events.get("fetch")!({ request, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
  });
});
