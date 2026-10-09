import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ clearSnapshots: vi.fn() }));
vi.mock("../../src/lib/offlineDb", () => ({
  clearProducerSnapshots: mocks.clearSnapshots,
}));

import { api, withAdminIdentityConfirmation } from "../../src/lib/api";
import {
  readAdminAccessToken,
  saveAdminSession,
} from "../../src/lib/adminSessionStore";
import { logoutCurrentBrowserSessions } from "../../src/lib/sessionLogout";

const fetchMock = vi.fn<typeof fetch>();
let events: string[];

beforeEach(() => {
  const storage = new Map<string, string>();
  events = [];
  vi.stubGlobal("location", { hostname: "hortvitalmix.vercel.app" });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("window", {
    dispatchEvent: (event: Event) => {
      events.push(event.type);
      return true;
    },
  });
  vi.stubGlobal("indexedDB", {});
  vi.stubGlobal("fetch", fetchMock);
  saveAdminSession({
    accessToken: "existing-access",
    refreshToken: "existing-refresh",
    expiresIn: 3600,
  });
  fetchMock.mockReset();
  mocks.clearSnapshots.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe("Safe browser exit is complete before navigation may continue", () => {
  it("waits for offline cleanup before announcing logout completion", async () => {
    let release!: () => void;
    mocks.clearSnapshots.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    let complete = false;
    const exit = logoutCurrentBrowserSessions().then(() => {
      complete = true;
    });
    await vi.waitFor(() => expect(mocks.clearSnapshots).toHaveBeenCalledOnce());
    expect(complete).toBe(false);
    expect(events).toContain("hvm:session-ending");
    expect(events).not.toContain("hvm:session-cleared");
    release();
    await exit;
    expect(complete).toBe(true);
    expect(events).toContain("hvm:session-cleared");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer existing-access",
    });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ refreshToken: "existing-refresh" }),
    );
    expect(readAdminAccessToken()).toBe("");
  });

  it("retains browser credentials when server revocation fails", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: "DEPENDENCY_UNAVAILABLE" }, { status: 503 }),
    );
    await expect(logoutCurrentBrowserSessions()).rejects.toMatchObject({
      message: "DEPENDENCY_UNAVAILABLE",
    });
    expect(readAdminAccessToken()).toBe("existing-access");
    expect(mocks.clearSnapshots).not.toHaveBeenCalled();
    expect(events).not.toContain("hvm:session-ending");
    expect(events).not.toContain("hvm:session-cleared");
  });

  it("fails closed and supports retry when private offline cleanup fails", async () => {
    fetchMock.mockImplementation(
      async () => new Response(null, { status: 204 }),
    );
    mocks.clearSnapshots.mockRejectedValueOnce(
      new Error("OFFLINE_STORAGE_UNAVAILABLE"),
    );
    await expect(logoutCurrentBrowserSessions()).rejects.toThrow(
      "OFFLINE_STORAGE_UNAVAILABLE",
    );
    expect(events).toContain("hvm:session-ending");
    expect(events).not.toContain("hvm:session-cleared");
    await logoutCurrentBrowserSessions();
    expect(mocks.clearSnapshots).toHaveBeenCalledTimes(2);
    expect(
      events.filter((name) => name === "hvm:session-cleared"),
    ).toHaveLength(1);
  });

  it("waits for refresh cookies and revokes the adopted refresh credentials", async () => {
    let releaseRefresh!: (response: Response) => void;
    let initial = true;
    fetchMock.mockImplementation(async (url) => {
      if (String(url).endsWith("/auth/refresh"))
        return new Promise<Response>((resolve) => {
          releaseRefresh = resolve;
        });
      if (String(url).endsWith("/auth/logout"))
        return new Response(null, { status: 204 });
      if (initial) {
        initial = false;
        return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
      }
      return Response.json({ invites: [] });
    });
    const read = api("/v1/admin/invites");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const exit = logoutCurrentBrowserSessions();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    releaseRefresh(
      Response.json({
        accessToken: "renewed-access",
        refreshToken: "renewed-refresh",
        expiresIn: 3600,
      }),
    );
    await Promise.all([read, exit]);
    const logout = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/auth/logout"),
    );
    expect(logout?.[1]?.headers).toMatchObject({
      Authorization: "Bearer renewed-access",
    });
    expect(logout?.[1]?.body).toBe(
      JSON.stringify({ refreshToken: "renewed-refresh" }),
    );
    expect(readAdminAccessToken()).toBe("");
  });

  it("waits for an in-flight password confirmation before revoking its new session", async () => {
    let release!: () => void;
    let started = false;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const confirmation = withAdminIdentityConfirmation(async () => {
      started = true;
      await pending;
      saveAdminSession({
        accessToken: "confirmed-access",
        refreshToken: "confirmed-refresh",
        expiresIn: 3600,
      });
    });
    await vi.waitFor(() => expect(started).toBe(true));
    const exit = logoutCurrentBrowserSessions();
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    release();
    await Promise.all([confirmation, exit]);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer confirmed-access",
    });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ refreshToken: "confirmed-refresh" }),
    );
    expect(readAdminAccessToken()).toBe("");
  });
});
