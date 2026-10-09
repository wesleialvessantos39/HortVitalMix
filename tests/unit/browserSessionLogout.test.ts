import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({ signOut: vi.fn(), refreshSession: vi.fn() }));
vi.mock("../../server/supabase/client.ts", () => ({
  supabaseAdmin: { auth: { admin: { signOut: mocks.signOut } } },
  supabasePublic: null,
  createSupabasePublicClient: () => ({
    auth: { refreshSession: mocks.refreshSession },
  }),
}));
vi.mock("../../server/db/pool.ts", () => ({ dbPool: null }));
import { authRouter } from "../../server/routes/authRoutes.ts";
import { revokeBrowserSessions } from "../../server/services/BrowserSessionLogoutService.ts";
const app = express().use(express.json()).use("/v1/auth", authRouter);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.refreshSession.mockResolvedValue({
    data: {},
    error: { status: 400, code: "refresh_token_not_found" },
  });
});

describe("Explicit exit revokes every identity present in this browser", () => {
  it.each(["platform_admin", "platform_super_admin", "consumer", "producer"])(
    "revokes the current %s cookie and a distinct administrative bearer",
    async (role) => {
      const result = await request(app)
        .post("/v1/auth/logout")
        .set(
          "Cookie",
          `hvm_access=synthetic-${role}; hvm_refresh=synthetic-public-refresh; hvm_portal_role=${role}`,
        )
        .set("Authorization", "Bearer synthetic-distinct-admin")
        .send({ refreshToken: "synthetic-admin-refresh" });
      expect(result.status).toBe(204);
      expect(mocks.signOut.mock.calls).toEqual([
        [`synthetic-${role}`, "local"],
        ["synthetic-distinct-admin", "local"],
      ]);
      const cleared = result.headers["set-cookie"] as unknown as string[];
      for (const name of [
        "hvm_access",
        "hvm_refresh",
        "hvm_portal_role",
        "hvm_reauth",
      ])
        expect(
          cleared.some(
            (value) =>
              value.startsWith(name + "=;") && value.includes("HttpOnly"),
          ),
        ).toBe(true);
      expect(mocks.refreshSession.mock.calls).toEqual([
        [{ refresh_token: "synthetic-public-refresh" }],
        [{ refresh_token: "synthetic-admin-refresh" }],
      ]);
    },
  );
  it("does not revoke the same cookie/bearer twice", async () => {
    expect(
      await revokeBrowserSessions([
        { accessToken: "same" },
        { accessToken: "same" },
      ]),
    ).toBe(true);
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith("same", "local");
  });
  it("revokes a distinct live refresh identity even after the access session was revoked", async () => {
    mocks.refreshSession.mockResolvedValue({
      data: { session: { access_token: "other-identity-access" } },
      error: null,
    });
    expect(
      await revokeBrowserSessions([
        {
          accessToken: "old-identity-access",
          refreshToken: "other-identity-refresh",
        },
      ]),
    ).toBe(true);
    expect(mocks.signOut.mock.calls).toEqual([
      ["old-identity-access", "local"],
      ["other-identity-access", "local"],
    ]);
  });
  it("checks distinct refresh tokens attached to an identical access token", async () => {
    expect(
      await revokeBrowserSessions([
        { accessToken: "same", refreshToken: "first" },
        { accessToken: "same", refreshToken: "second" },
      ]),
    ).toBe(true);
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith("same", "local");
    expect(mocks.refreshSession.mock.calls).toEqual([
      [{ refresh_token: "first" }],
      [{ refresh_token: "second" }],
    ]);
  });
  it("revokes a remaining refresh cookie even when the access cookie expired", async () => {
    mocks.refreshSession.mockResolvedValue({
      data: { session: { access_token: "logout-only-access" } },
      error: null,
    });
    const result = await request(app)
      .post("/v1/auth/logout")
      .set("Cookie", "hvm_refresh=live-refresh-without-access")
      .send({});
    expect(result.status).toBe(204);
    expect(mocks.refreshSession).toHaveBeenCalledExactlyOnceWith({
      refresh_token: "live-refresh-without-access",
    });
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith(
      "logout-only-access",
      "local",
    );
    expect(JSON.stringify(result.headers["set-cookie"])).not.toContain(
      "logout-only-access",
    );
    expect(result.text).toBe("");
  });
  it("does not mistake an expired JWT for a revoked refresh session", async () => {
    mocks.signOut
      .mockResolvedValueOnce({ error: { status: 401 } })
      .mockResolvedValueOnce({ error: null });
    mocks.refreshSession.mockResolvedValue({
      data: { session: { access_token: "revocation-only" } },
      error: null,
    });
    expect(
      await revokeBrowserSessions([
        { accessToken: "expired", refreshToken: "still-live" },
      ]),
    ).toBe(true);
    expect(mocks.signOut.mock.calls).toEqual([
      ["expired", "local"],
      ["revocation-only", "local"],
    ]);
  });
  it("retains credentials for retry and fails closed when revocation is unavailable", async () => {
    mocks.signOut.mockResolvedValue({ error: { status: 503 } });
    const result = await request(app)
      .post("/v1/auth/logout")
      .set("Cookie", "hvm_access=existing")
      .send({});
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: "DEPENDENCY_UNAVAILABLE" });
    expect(result.headers["set-cookie"]).toBeUndefined();
  });
  it("fails closed when refreshing an expired session is unavailable", async () => {
    mocks.signOut.mockResolvedValue({ error: { status: 401 } });
    mocks.refreshSession.mockResolvedValue({
      data: {},
      error: { status: 503 },
    });
    expect(
      await revokeBrowserSessions([
        { accessToken: "expired", refreshToken: "live" },
      ]),
    ).toBe(false);
  });
  it("accepts a session that Auth already revoked", async () => {
    mocks.refreshSession.mockResolvedValue({
      data: {},
      error: { status: 400, code: "refresh_token_not_found" },
    });
    expect(
      await revokeBrowserSessions([{ refreshToken: "already-revoked" }]),
    ).toBe(true);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it.each([401, 403])(
    "does not mistake a generic refresh %s for confirmed revocation",
    async (status) => {
      mocks.refreshSession.mockResolvedValue({ data: {}, error: { status } });
      expect(
        await revokeBrowserSessions([{ refreshToken: "potentially-live" }]),
      ).toBe(false);
    },
  );
  it("fails closed when freshly minted logout-only credentials cannot be revoked", async () => {
    mocks.refreshSession.mockResolvedValue({
      data: { session: { access_token: "fresh-logout-only" } },
      error: null,
    });
    mocks.signOut.mockResolvedValue({ error: { status: 401 } });
    expect(
      await revokeBrowserSessions([{ refreshToken: "potentially-live" }]),
    ).toBe(false);
  });
  it("does not treat a misconfigured API key as an expired user token", async () => {
    mocks.signOut.mockResolvedValue({
      error: { status: 401, code: "invalid_api_key" },
    });
    expect(
      await revokeBrowserSessions([{ accessToken: "potentially-live" }]),
    ).toBe(false);
  });
  it("validates refresh input before contacting Auth", async () => {
    const result = await request(app)
      .post("/v1/auth/logout")
      .send({ refreshToken: {} });
    expect(result.status).toBe(400);
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });
});
