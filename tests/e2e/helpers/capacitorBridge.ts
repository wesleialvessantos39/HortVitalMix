import type { Page } from "@playwright/test";

// Browser fixture only: exercises the production JS/native-plugin interface.
// This is not a physical Android/iOS cookie-store or package-signing test.
export async function emulateCapacitorBridge(
  page: Page,
  platform: "android" | "ios",
  info = { id: "br.com.hortivitalmix.app", name: "HortiVitalMix", version: "1.0.0", build: "1" },
) {
  await page.addInitScript(({ platform, info }) => {
    type Options = { url?: string; method?: string; headers?: Record<string, string>; data?: string; responseType?: string; eventName?: string };
    const root = globalThis as unknown as {
      androidBridge?: object;
      webkit?: { messageHandlers: { bridge: object } };
      Capacitor?: object;
      __HVM_TEST_NATIVE_CALLS?: Array<{ plugin: string; method: string; options: Options }>;
      __HVM_TEST_APP_CALLBACKS?: Record<string, (event: unknown) => void>;
    };
    if (platform === "android") root.androidBridge = {};
    else root.webkit = { messageHandlers: { bridge: {} } };
    root.__HVM_TEST_NATIVE_CALLS = [];
    root.__HVM_TEST_APP_CALLBACKS = {};
    root.Capacitor = {
      PluginHeaders: [
        { name: "CapacitorHttp", methods: [{ name: "request", rtype: "promise" }] },
        { name: "App", methods: [{ name: "getInfo", rtype: "promise" }, { name: "addListener", rtype: "callback" }, { name: "removeListener", rtype: "promise" }] },
        { name: "Browser", methods: [{ name: "open", rtype: "promise" }] },
      ],
      nativeCallback(plugin: string, method: string, options: Options, callback: (event: unknown) => void) {
        if (plugin === "App" && method === "addListener") {
          root.__HVM_TEST_APP_CALLBACKS![options.eventName!] = callback;
          return "fixture-listener-" + options.eventName;
        }
        throw new Error("Unimplemented test native callback " + plugin + "." + method);
      },
      async nativePromise(plugin: string, method: string, options: Options) {
        root.__HVM_TEST_NATIVE_CALLS!.push({ plugin, method, options });
        if (plugin === "App" && method === "getInfo") return info;
        if ((plugin === "App" && method === "removeListener") || (plugin === "Browser" && method === "open")) return {};
        if (plugin !== "CapacitorHttp" || method !== "request")
          throw new Error("Unimplemented test native plugin " + plugin + "." + method);
        const target = new URL(options.url!);
        if (target.origin !== "https://hortvitalmix.vercel.app")
          throw new Error("Unexpected test backend origin");
        const headers = { ...options.headers };
        delete headers.origin;
        // Use the existing page.route HTTP fixtures; never contact production.
        const response = await fetch(target.pathname + target.search, {
          method: options.method, headers,
          ...(options.data === undefined ? {} : { body: options.data }),
        });
        const type = response.headers.get("content-type") ?? "";
        const data = type.includes("json") ? await response.json() :
          options.responseType === "arraybuffer"
            ? btoa(String.fromCharCode(...new Uint8Array(await response.arrayBuffer())))
            : await response.text();
        return { data, status: response.status, headers: Object.fromEntries(response.headers.entries()), url: options.url };
      },
    };
  }, { platform, info });
}
