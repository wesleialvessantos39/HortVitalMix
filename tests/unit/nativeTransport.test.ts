import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ native: true, platform: "android", request: vi.fn() }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => mocks.native, getPlatform: () => mocks.platform },
  CapacitorHttp: { request: mocks.request },
}));
import {
  fetchAppApi, hasPendingNativeMutations, hasPendingNativeSessionChanges,
  nativeBackendOrigin, waitForNativeSessionChanges,
} from "../../src/lib/nativeTransport";
import { api, apiBase, fetchApiFile, hasPendingApiMutations, hasPendingSessionChanges, withAdminIdentityConfirmation } from "../../src/lib/api";
import { saveAdminSession } from "../../src/lib/adminSessionStore";

const origin = "https://hortvitalmix.vercel.app";
beforeEach(() => {
  mocks.native = true;
  mocks.platform = "android";
  mocks.request.mockReset();
  vi.stubEnv("VITE_HVM_NATIVE_BACKEND_ORIGIN", "");
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(async () => { await waitForNativeSessionChanges(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const result = (data: unknown, status = 200, url = origin + "/api/v1/auth/session") => ({
  status, data, url, headers: { "Content-Type": "application/json", "x-request-id": "native-test" },
});

describe("compiled native backend and confined authenticated transport", () => {
  it.each(["android", "ios"])("preserves raw upload bytes through the %s native file bridge", async (platform) => {
    mocks.platform = platform;
    mocks.request.mockResolvedValue(result({ status: "uploaded" }, 200, origin + "/api/v1/producer/store/media"));
    const bytes = Uint8Array.from([0xff, 0xd8, 0, 128, 255, 10, 0xff, 0xd9]);
    const blob = new Blob([bytes], { type: "image/jpeg" });
    await expect(api("/v1/producer/store/media", { method: "POST", body: blob, headers: { "Content-Type": "image/jpeg" } })).resolves.toEqual({ status: "uploaded" });
    const sent = mocks.request.mock.calls[0][0];
    expect(sent.dataType).toBe("file");
    expect(sent.headers["content-type"]).toBe("image/jpeg");
    expect(Uint8Array.from(atob(sent.data), c => c.charCodeAt(0))).toEqual(bytes);
  });
  it("rejects unsupported binary bodies and oversized native files before sending", async () => {
    await expect(fetchAppApi("/api/v1/producer/store/media", { method: "POST", body: new FormData() })).rejects.toMatchObject({ message: "NATIVE_BODY_UNSUPPORTED" });
    await expect(fetchAppApi("/api/v1/producer/store/media", { method: "POST", body: new Blob([new Uint8Array(32 * 1024 * 1024 + 1)]) })).rejects.toMatchObject({ message: "NATIVE_FILE_SIZE_OR_METHOD_INVALID" });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it.each(["android", "ios"])("uses the approved HTTPS API on %s", async (platform) => {
    mocks.platform = platform;
    mocks.request.mockResolvedValue(result({ roles: ["producer"] }));
    expect(apiBase()).toBe(origin + "/api");
    await expect(api("/v1/auth/session")).resolves.toEqual({ roles: ["producer"] });
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({
      url: origin + "/api/v1/auth/session", method: "GET", disableRedirects: true,
      headers: expect.objectContaining({ origin, "x-hvm-request": "1" }),
      connectTimeout: 20000, readTimeout: 20000,
    }));
  });

  it("accepts an owned future domain only through build configuration", () => {
    vi.stubEnv("VITE_HVM_NATIVE_BACKEND_ORIGIN", "https://owned-domain.example");
    vi.stubGlobal("location", { search: "?api=https://attacker.example" });
    expect(nativeBackendOrigin()).toBe("https://owned-domain.example");
    expect(apiBase()).toBe("https://owned-domain.example/api");
  });

  it.each(["http://owned.example", "https://name:secret@owned.example", "https://owned.example:8443", "https://owned.example/api", "https://owned.example?api=evil", "https://owned.example#key", "https://127.0.0.1", "https://localhost", "https://server.internal"])(
    "rejects unsafe compiled backend %s before sending credentials", async (configured) => {
      vi.stubEnv("VITE_HVM_NATIVE_BACKEND_ORIGIN", configured);
      await expect(fetchAppApi("/api/v1/auth/session")).rejects.toMatchObject({ message: "NATIVE_BACKEND_INVALID" });
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it.each(["https://attacker.example/api/v1/auth/session", "https://user:secret@hortvitalmix.vercel.app/api/v1/auth/session", "/api/v1/auth/session#secret", "/downloads/android", "/api/v1/auth/%2e%2e/admin", "/api/v1/auth/%2Fadmin"])(
    "confines native requests before sending to %s", async (url) => {
      await expect(fetchAppApi(url)).rejects.toMatchObject({ message: "NATIVE_API_URL_REJECTED" });
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it("removes JS cookie overrides and never returns Set-Cookie to the app", async () => {
    mocks.request.mockResolvedValue({ ...result({ ok: true }), headers: { "Content-Type": "application/json", "Set-Cookie": "hvm_access=private; HttpOnly" } });
    const response = await fetchAppApi("/api/v1/auth/session", { headers: { Cookie: "injected=private", Host: "attacker.example", Origin: "https://attacker.example" } });
    expect(mocks.request.mock.calls[0][0].headers).toEqual({ origin, "x-hvm-request": "1" });
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it.each([302, 307])("does not follow native credential redirects (%s)", async (status) => {
    mocks.request.mockResolvedValue(result("redirect", status));
    await expect(fetchAppApi("/api/v1/auth/session")).rejects.toMatchObject({ message: "NATIVE_API_REDIRECT_REJECTED" });
    expect(mocks.request.mock.calls[0][0].disableRedirects).toBe(true);
  });

  it("rejects an unexpected final host even when a bridge violates redirect policy", async () => {
    mocks.request.mockResolvedValue(result({ ok: true }, 200, "https://attacker.example/api/v1/auth/session"));
    await expect(fetchAppApi("/api/v1/auth/session")).rejects.toMatchObject({ message: "NATIVE_API_URL_REJECTED" });
  });

  it.each([204, 205])("keeps empty native response semantics for %s", async (status) => {
    mocks.request.mockResolvedValue(result("", status));
    const response = await fetchAppApi("/api/v1/auth/logout", { method: "POST" });
    expect(response.status).toBe(status);
    expect(await response.text()).toBe("");
  });

  it("preserves structured API errors without replaying failed password confirmation", async () => {
    mocks.request.mockResolvedValue(result({ error: "ADMIN_REAUTHENTICATION_REQUIRED" }, 401));
    await expect(api("/v1/admin/invites", { method: "POST", body: "{}" })).rejects.toMatchObject({ message: "ADMIN_REAUTHENTICATION_REQUIRED", status: 401, requestId: "native-test" });
    expect(mocks.request).toHaveBeenCalledOnce();
  });

  it("renews an administrative native token on the same trusted backend once", async () => {
    saveAdminSession({ accessToken: "expired", refreshToken: "refresh", expiresIn: 3600 });
    mocks.request.mockResolvedValueOnce(result({ error: "UNAUTHORIZED" }, 401))
      .mockResolvedValueOnce(result({ accessToken: "fresh", refreshToken: "fresh-refresh", expiresIn: 3600 }))
      .mockResolvedValueOnce(result({ ok: true }));
    await expect(api("/v1/admin/dashboard")).resolves.toEqual({ ok: true });
    expect(mocks.request.mock.calls.map(([input]) => input.url)).toEqual([
      origin + "/api/v1/admin/dashboard", origin + "/api/v1/auth/refresh", origin + "/api/v1/admin/dashboard",
    ]);
    expect(mocks.request.mock.calls[2][0].headers.authorization).toBe("Bearer fresh");
    expect(mocks.request.mock.calls[1][0].data).toBe(JSON.stringify({ refreshToken: "refresh" }));
  });

  it("producer cookie renewal remains within the same native cookie jar", async () => {
    mocks.request.mockResolvedValueOnce(result({ error: "SESSION_EXPIRED" }, 401))
      .mockResolvedValueOnce(result({ ok: true }))
      .mockResolvedValueOnce(result({ roles: ["producer"] }));
    await expect(api("/v1/auth/session")).resolves.toEqual({ roles: ["producer"] });
    expect(mocks.request.mock.calls.map(([input]) => input.url)).toEqual([
      origin + "/api/v1/auth/session", origin + "/api/v1/auth/refresh", origin + "/api/v1/auth/session",
    ]);
    expect(mocks.request.mock.calls[1][0].headers.origin).toBe(origin);
    expect(mocks.request.mock.calls[1][0].data).toBeUndefined();
  });

  it("decodes protected PDF bytes using the native authenticated transport", async () => {
    saveAdminSession({ accessToken: "file-token", refreshToken: "refresh", expiresIn: 3600 });
    mocks.request.mockResolvedValue({ ...result(btoa("%PDF-private")), headers: { "Content-Type": "application/pdf" } });
    const response = await fetchApiFile("/v1/admin/documents/id/file");
    expect(await response.text()).toBe("%PDF-private");
    expect(mocks.request.mock.calls[0][0].responseType).toBe("arraybuffer");
    expect(mocks.request.mock.calls[0][0].headers.authorization).toBe("Bearer file-token");
  });

  it("does not send a native operation that was already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fetchAppApi("/api/v1/auth/login", { signal: controller.signal, method: "POST" })).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("keeps aborted native cookie writes pending until completion before logout/identity change", async () => {
    let finish!: (value: ReturnType<typeof result>) => void;
    mocks.request.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const controller = new AbortController();
    const request = fetchAppApi("/api/v1/auth/refresh", { method: "POST", signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(hasPendingNativeMutations()).toBe(true);
    expect(hasPendingNativeSessionChanges()).toBe(true);
    expect(hasPendingApiMutations()).toBe(true);
    expect(hasPendingSessionChanges()).toBe(true);
    const confirm = vi.fn().mockResolvedValue("confirmed-after-native-completion");
    const confirmation = withAdminIdentityConfirmation(confirm);
    await Promise.resolve();
    expect(confirm).not.toHaveBeenCalled();
    finish(result({ ok: true }));
    await expect(confirmation).resolves.toBe("confirmed-after-native-completion");
    expect(hasPendingNativeMutations()).toBe(false);
    expect(hasPendingNativeSessionChanges()).toBe(false);
  });

  it("leaves browser same-origin fetch unchanged even when native backend env is configured", async () => {
    mocks.native = false;
    vi.stubEnv("VITE_HVM_NATIVE_BACKEND_ORIGIN", "https://owned.example");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ web: true }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await fetchAppApi("/api/v1/auth/session", { credentials: "same-origin" });
    await expect(response.json()).resolves.toEqual({ web: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/session", { credentials: "same-origin" });
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
