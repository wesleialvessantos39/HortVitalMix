import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" },
  CapacitorHttp: { request: vi.fn() },
}));
import { api, apiBase, fetchApiFile } from "../../src/lib/api";
import { saveAdminSession } from "../../src/lib/adminSessionStore";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("API transport on a future owned Vercel domain", () => {
  it.each(["hortvitalmix.vercel.app", "hortivitalmix.com.br", "www.hortivitalmix.com.br", "my-new-owned.example", "localhost"])(
    "uses /api on %s without guessing it is a Studio proxy", async (hostname) => {
      vi.stubGlobal("location", { hostname, origin: "https://" + hostname });
      fetchMock.mockImplementation(async (input) => String(input).startsWith("/_hvm_api")
        ? new Response("<!doctype html><main>app</main>", { headers: { "Content-Type": "text/html" } })
        : Response.json({ roles: ["producer"] }));
      expect(apiBase()).toBe("/api");
      await expect(api("/v1/auth/session")).resolves.toEqual({ roles: ["producer"] });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/auth/session");
      expect(fetchMock.mock.calls[0][1]?.credentials).toBe("same-origin");
    },
  );

  it.each(["aistudio.google.com", "preview.usercontent.goog", "preview.googleusercontent.com"])(
    "preserves the known Google Studio proxy on %s", async (hostname) => {
      vi.stubGlobal("location", { hostname });
      fetchMock.mockResolvedValueOnce(Response.json({ error: "NOT_FOUND" }, { status: 404 }))
        .mockResolvedValueOnce(Response.json({ session: "active" }));
      expect(apiBase()).toBe("/_hvm_api");
      await expect(api("/v1/auth/session")).resolves.toEqual({ session: "active" });
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/_hvm_api/v1/auth/session", "/api/v1/auth/session"]);
    },
  );

  it.each(["ORIGIN_NOT_ALLOWED", "ORIGIN_REJECTED", "disabled", "email_not_authorized"])(
    "does not replay a rejected mutation after definitive %s", async (error) => {
      vi.stubGlobal("location", { hostname: "preview.usercontent.goog" });
      fetchMock.mockResolvedValue(Response.json({ error }, { status: 403 }));
      await expect(api("/v1/auth/login", { method: "POST", body: "{}" })).rejects.toMatchObject({ message: error, status: 403 });
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it("uses the same custom-host transport when an administrative token is renewed", async () => {
    vi.stubGlobal("location", { hostname: "my-new-owned.example" });
    saveAdminSession({ accessToken: "old", refreshToken: "refresh", expiresIn: 3600 });
    fetchMock.mockResolvedValueOnce(Response.json({ error: "UNAUTHORIZED" }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ accessToken: "fresh", refreshToken: "fresh-refresh", expiresIn: 3600 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    await expect(api("/v1/admin/dashboard")).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/v1/admin/dashboard", "/api/v1/auth/refresh", "/api/v1/admin/dashboard"]);
    expect(fetchMock.mock.calls[2][1]?.headers).toMatchObject({ Authorization: "Bearer fresh" });
  });

  it("recovers a read when a known Studio proxy returns SPA HTML", async () => {
    vi.stubGlobal("location", { hostname: "preview.usercontent.goog" });
    fetchMock.mockResolvedValueOnce(new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } }))
      .mockResolvedValueOnce(Response.json({ session: "active" }));
    await expect(api("/v1/auth/session")).resolves.toEqual({ session: "active" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never repeats a mutation after an ambiguous successful HTML response", async () => {
    vi.stubGlobal("location", { hostname: "preview.usercontent.goog" });
    fetchMock.mockResolvedValue(new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } }));
    await expect(api("/v1/auth/login", { method: "POST", body: "{}" })).rejects.toMatchObject({ message: "INVALID_API_RESPONSE" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not send document credentials to an external file URL", async () => {
    vi.stubGlobal("location", { hostname: "my-new-owned.example", origin: "https://my-new-owned.example" });
    await expect(fetchApiFile("https://attacker.example/api/v1/admin/documents/id/file")).rejects.toMatchObject({ message: "API_FILE_URL_REJECTED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds the administrative bearer to protected files on the owned domain", async () => {
    vi.stubGlobal("location", { hostname: "my-new-owned.example", origin: "https://my-new-owned.example" });
    saveAdminSession({ accessToken: "file-token", refreshToken: "refresh", expiresIn: 3600 });
    fetchMock.mockResolvedValue(new Response("file", { headers: { "Content-Type": "application/pdf" } }));
    await expect(fetchApiFile("/v1/admin/documents/id/file")).resolves.toBeInstanceOf(Response);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/admin/documents/id/file");
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer file-token");
  });
});
