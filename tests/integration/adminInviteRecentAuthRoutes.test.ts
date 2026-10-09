import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminRole } from "../../shared/contracts/adminGovernance.ts";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  login: vi.fn(),
  reauthenticate: vi.fn(),
  createInvite: vi.fn(),
  removeInvite: vi.fn(),
  clearInviteHistory: vi.fn(),
}));
vi.mock("../../server/supabase/client.ts", () => ({
  supabaseAdmin: {
    auth: { getUser: mocks.getUser },
    from: mocks.from,
    rpc: mocks.rpc,
  },
  supabasePublic: null,
  createSupabasePublicClient: () => null,
}));
vi.mock("../../server/db/pool.ts", () => ({ dbPool: null }));
vi.mock("../../server/config/runtime.ts", () => ({
  runtime: {
    appEnv: "production",
    secureCookies: true,
    origins: ["https://hortvitalmix.vercel.app"],
    ipPepper: "local-test-secret-never-a-production-credential",
  },
}));
vi.mock("../../server/services/AdminGovernanceService.ts", () => ({
  AdminGovernanceService: mocks,
}));
vi.mock("../../server/routes/adminRuralPropertyRoutes.ts", async () => ({
  adminRuralPropertyRouter: (await import("express")).Router(),
}));
vi.mock("../../server/routes/adminAccountReviewRoutes.ts", async () => ({
  adminAccountReviewRouter: (await import("express")).Router(),
}));
import { adminGovernanceRouter } from "../../server/routes/adminGovernanceRoutes.ts";
import {
  issueRecentAuthProof,
  RECENT_AUTH_WINDOW_MS,
  verifyRecentAuthProof,
} from "../../server/security/recentAuth.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const inviteId = "44444444-4444-4444-8444-444444444444";
const commandId = "33333333-3333-4333-8333-333333333333";
const origin = "https://hortvitalmix.vercel.app";
const oldSession = new Date(Date.now() - 30 * 60_000).toISOString();
let actorRole: AdminRole;
let blocked = false;
let denied = false;
let tokenSessionExists = true;

function token(iat = Math.floor(Date.now() / 1000), sid = sessionId) {
  return (
    "header." +
    Buffer.from(JSON.stringify({ session_id: sid, iat })).toString(
      "base64url",
    ) +
    ".test-auth-adapter"
  );
}
function query(data: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "is"])
    chain[method] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data, error: null }));
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data, error: null }).then(resolve);
  return chain;
}
function cookies(proof?: string, access = token()) {
  return (
    `hvm_access=${access}; hvm_portal_role=${actorRole}` +
    (proof ? `; hvm_reauth=${proof}` : "")
  );
}
function sessionCreated(role = actorRole, id = userId) {
  return {
    status: "session_created",
    userId: id,
    role,
    sectors: role === "platform_admin" ? ["account_governance"] : [],
    deniedSectors: [],
    accessToken: token(),
    refreshToken: "local-synthetic-refresh",
    expiresIn: 3600,
  };
}
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.requestId = commandId;
  req.clientIpHash = "a".repeat(64);
  next();
});
app.use("/v1/admin", adminGovernanceRouter);
function mutation(method: "post" | "delete", path: string, cookie = cookies()) {
  return request(app)[method](path).set("Origin", origin).set("Cookie", cookie);
}

beforeEach(() => {
  vi.resetAllMocks();
  actorRole = "platform_super_admin";
  blocked = false;
  denied = false;
  tokenSessionExists = true;
  mocks.getUser.mockResolvedValue({
    data: { user: { id: userId, email_confirmed_at: "2026-01-01" } },
    error: null,
  });
  mocks.rpc.mockImplementation(async () => ({
    data: tokenSessionExists ? [{ created_at: oldSession }] : [],
    error: null,
  }));
  mocks.from.mockImplementation((table: string) =>
    query(
      (
        {
          app_admin_principals: {
            admin_user_id: userId,
            portal_role: actorRole,
          },
          app_user_role_assignments: [
            { role_code: actorRole, expires_at: null },
          ],
          app_users: { status: blocked ? "suspended" : "active" },
          app_admin_sector_members: [
            { sector_code: "account_governance", expires_at: null },
          ],
          app_admin_permission_overrides: denied
            ? [{ sector_code: "account_governance" }]
            : [],
        } as Record<string, unknown>
      )[table],
    ),
  );
  mocks.reauthenticate.mockImplementation(async () => sessionCreated());
  mocks.createInvite.mockResolvedValue({
    status: "created",
    invite: { id: inviteId },
  });
  mocks.removeInvite.mockResolvedValue({ status: "deleted" });
  mocks.clearInviteHistory.mockResolvedValue({ status: "cleared", count: 1 });
});

describe("administrative invite recent credential confirmation", () => {
  it.each(["platform_admin", "platform_super_admin"])(
    "blocks an old session before issuing an invite for %s",
    async (targetRole) => {
      const response = await mutation("post", "/v1/admin/invites").send({
        email: "recipient@example.invalid",
        targetRole,
        sectors: targetRole === "platform_admin" ? ["account_governance"] : [],
        commandId,
      });
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        error: "ADMIN_REAUTHENTICATION_REQUIRED",
        actorId: userId,
      });
      expect(mocks.createInvite).not.toHaveBeenCalled();
    },
  );

  it.each(["platform_admin", "platform_super_admin"] as const)(
    "confirms %s with password only and allows the retained invite after confirmation",
    async (role) => {
      actorRole = role;
      const confirmed = await mutation(
        "post",
        "/v1/admin/auth/reauthenticate",
      ).send({ password: "synthetic-password" });
      expect(confirmed.status).toBe(200);
      expect(mocks.reauthenticate).toHaveBeenCalledExactlyOnceWith(
        userId,
        role,
        "synthetic-password",
        "a".repeat(64),
        commandId,
      );
      const headers = confirmed.headers["set-cookie"] as unknown as string[];
      const proofCookie = headers.find((value) =>
        value.startsWith("hvm_reauth="),
      )!;
      expect(proofCookie).toContain("HttpOnly");
      expect(proofCookie).toContain("Secure");
      expect(proofCookie).toContain("Max-Age=900");
      const proof = decodeURIComponent(
        proofCookie.split(";")[0].slice("hvm_reauth=".length),
      );
      expect(
        verifyRecentAuthProof(proof, userId, confirmed.body.accessToken),
      ).toBe(true);
      const confirmedCookies = headers
        .map((value) => value.split(";")[0])
        .join("; ");
      const created = await mutation(
        "post",
        "/v1/admin/invites",
        confirmedCookies,
      ).send({
        email: "recipient@example.invalid",
        targetRole: "platform_admin",
        sectors: ["account_governance"],
        commandId,
      });
      expect(created.status).toBe(201);
      expect(mocks.createInvite).toHaveBeenCalledOnce();
    },
  );

  it("accepts fresh proof while the canonical session itself is older than 15 minutes", async () => {
    const access = token();
    const response = await mutation(
      "post",
      "/v1/admin/invites",
      cookies(issueRecentAuthProof(userId, access), access),
    ).send({
      email: "recipient@example.invalid",
      targetRole: "platform_super_admin",
      sectors: [],
      commandId,
    });
    expect(response.status).toBe(201);
  });

  it("does not make old credentials recent by refreshing JWT iat", async () => {
    const access = token(Math.floor(Date.now() / 1000) + 60);
    const response = await mutation(
      "post",
      "/v1/admin/invites",
      cookies(undefined, access),
    ).send({
      email: "recipient@example.invalid",
      targetRole: "platform_super_admin",
      sectors: [],
      commandId,
    });
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("ADMIN_REAUTHENTICATION_REQUIRED");
    expect(mocks.createInvite).not.toHaveBeenCalled();
  });

  it("rejects expired confirmation and a proof belonging to another session", async () => {
    for (const proof of [
      issueRecentAuthProof(
        userId,
        token(),
        Date.now() - RECENT_AUTH_WINDOW_MS - 1,
      ),
      issueRecentAuthProof(
        userId,
        token(undefined, "55555555-5555-4555-8555-555555555555"),
      ),
    ]) {
      const response = await mutation(
        "post",
        "/v1/admin/invites",
        cookies(proof),
      ).send({
        email: "recipient@example.invalid",
        targetRole: "platform_super_admin",
        sectors: [],
        commandId,
      });
      expect(response.status).toBe(401);
    }
    expect(mocks.createInvite).not.toHaveBeenCalled();
  });

  it.each([
    "invalid_credentials",
    "no_admin_role",
    "account_blocked",
    "unavailable",
  ])(
    "does not mint a confirmation cookie when confirmation returns %s",
    async (status) => {
      mocks.reauthenticate.mockResolvedValue({ status });
      const response = await mutation(
        "post",
        "/v1/admin/auth/reauthenticate",
      ).send({ password: "synthetic-password" });
      expect(response.status).toBe(
        status === "invalid_credentials"
          ? 401
          : status === "unavailable"
            ? 503
            : 403,
      );
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(mocks.createInvite).not.toHaveBeenCalled();
    },
  );

  it("keeps credential attempt rate limits on confirmation", async () => {
    mocks.reauthenticate.mockResolvedValue({
      status: "rate_limited",
      retryAfterSeconds: 90,
    });
    const response = await mutation(
      "post",
      "/v1/admin/auth/reauthenticate",
    ).send({ password: "synthetic-password" });
    expect(response.status).toBe(429);
    expect(response.headers["retry-after"]).toBe("90");
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it.each([
    sessionCreated(
      "platform_super_admin",
      "66666666-6666-4666-8666-666666666666",
    ),
    sessionCreated("platform_admin"),
  ])("never mints cookies for another identity or portal", async (result) => {
    mocks.reauthenticate.mockResolvedValue(result);
    const response = await mutation(
      "post",
      "/v1/admin/auth/reauthenticate",
    ).send({ password: "synthetic-password" });
    expect(response.status).toBe(401);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it.each([
    { password: "synthetic-password", email: "other@example.invalid" },
    { password: "synthetic-password", portalRole: "platform_admin" },
    { password: "" },
  ])(
    "does not let the client choose another account or portal",
    async (body) => {
      const response = await mutation(
        "post",
        "/v1/admin/auth/reauthenticate",
      ).send(body);
      expect(response.status).toBe(422);
      expect(mocks.reauthenticate).not.toHaveBeenCalled();
    },
  );

  it("rejects a missing or deleted live session even with a valid proof", async () => {
    tokenSessionExists = false;
    const response = await mutation(
      "post",
      "/v1/admin/auth/reauthenticate",
      cookies(issueRecentAuthProof(userId, token())),
    ).send({ password: "synthetic-password" });
    expect(response.status).toBe(401);
    expect(mocks.reauthenticate).not.toHaveBeenCalled();
  });

  it("rejects blocked accounts before verifying a password", async () => {
    blocked = true;
    const response = await mutation(
      "post",
      "/v1/admin/auth/reauthenticate",
    ).send({ password: "synthetic-password" });
    expect(response.status).toBe(403);
    expect(mocks.reauthenticate).not.toHaveBeenCalled();
  });

  it("keeps a revoked governance power revoked after confirmation", async () => {
    denied = true;
    const response = await mutation(
      "post",
      "/v1/admin/invites",
      cookies(issueRecentAuthProof(userId, token())),
    ).send({
      email: "recipient@example.invalid",
      targetRole: "platform_super_admin",
      sectors: [],
      commandId,
    });
    expect(response.status).toBe(403);
    expect(mocks.createInvite).not.toHaveBeenCalled();
  });

  it("retains recent-auth guards for deletion and history cleanup", async () => {
    expect(
      (
        await mutation("delete", `/v1/admin/invites/${inviteId}`).send({
          expectedRevision: 1,
          commandId,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await mutation("post", "/v1/admin/invites/clear-history").send({
          commandId,
        })
      ).status,
    ).toBe(401);
    expect(mocks.removeInvite).not.toHaveBeenCalled();
    expect(mocks.clearInviteHistory).not.toHaveBeenCalled();
  });

  it("rejects cross-site credential confirmation", async () => {
    const response = await request(app)
      .post("/v1/admin/auth/reauthenticate")
      .set("Origin", "https://untrusted.example.invalid")
      .set("Sec-Fetch-Site", "cross-site")
      .set("Cookie", cookies())
      .send({ password: "synthetic-password" });
    expect(response.status).toBe(403);
    expect(mocks.reauthenticate).not.toHaveBeenCalled();
  });
});
