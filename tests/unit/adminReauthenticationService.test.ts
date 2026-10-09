import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminLoginResult } from "../../shared/contracts/adminGovernance.ts";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  signOut: vi.fn(),
  maybeSingle: vi.fn(),
  eq: vi.fn(),
}));
vi.mock("../../server/supabase/client.ts", () => ({
  supabaseAdmin: {
    from: mocks.from,
    auth: { admin: { signOut: mocks.signOut } },
  },
  supabasePublic: null,
  createSupabasePublicClient: () => null,
}));
vi.mock("../../server/db/pool.ts", () => ({ dbPool: null }));
import { AdminGovernanceService } from "../../server/services/AdminGovernanceService.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const canonicalEmail = "canonical.admin@example.invalid";
const role = "platform_super_admin" as const;
function created(): AdminLoginResult {
  return {
    status: "session_created",
    userId,
    role,
    sectors: [],
    accessToken: "local-auth-result-not-a-real-token",
    refreshToken: "local-refresh-result",
    expiresIn: 3600,
  };
}
function confirm() {
  return AdminGovernanceService.reauthenticate(
    userId,
    role,
    "synthetic-password",
    "synthetic-ip-hash",
    "local-request-id",
  );
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  const chain = {
    select: vi.fn(() => chain),
    eq: mocks.eq.mockImplementation(() => chain),
    maybeSingle: mocks.maybeSingle,
  };
  mocks.from.mockReturnValue(chain);
  mocks.maybeSingle.mockResolvedValue({
    data: { admin_email: canonicalEmail },
    error: null,
  });
  mocks.signOut.mockResolvedValue({ error: null });
});

describe("password confirmation bound to the current administrative principal", () => {
  it("resolves the current principal's canonical administrative address and reuses login policy", async () => {
    const login = vi
      .spyOn(AdminGovernanceService, "login")
      .mockResolvedValue(created());
    expect(await confirm()).toEqual(created());
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("app_admin_principals");
    expect(mocks.eq).toHaveBeenCalledWith("admin_user_id", userId);
    expect(mocks.eq).toHaveBeenCalledWith("portal_role", role);
    expect(login).toHaveBeenCalledExactlyOnceWith(
      canonicalEmail,
      "synthetic-password",
      "synthetic-ip-hash",
      "local-request-id",
      role,
    );
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it.each([
    "invalid_credentials",
    "rate_limited",
    "account_blocked",
    "no_admin_role",
  ] as const)(
    "retains the login policy result %s without issuing a different session",
    async (status) => {
      const result = { status, retryAfterSeconds: 60 } as AdminLoginResult;
      vi.spyOn(AdminGovernanceService, "login").mockResolvedValue(result);
      expect(await confirm()).toEqual(result);
      expect(mocks.signOut).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the principal lookup is unavailable", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: null,
      error: { code: "local-dependency-error" },
    });
    const login = vi.spyOn(AdminGovernanceService, "login");
    expect(await confirm()).toEqual({ status: "unavailable" });
    expect(login).not.toHaveBeenCalled();
  });

  it("cannot confirm a removed principal", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    const login = vi.spyOn(AdminGovernanceService, "login");
    expect(await confirm()).toEqual({ status: "no_admin_role" });
    expect(login).not.toHaveBeenCalled();
  });

  it.each([
    { ...created(), userId: "22222222-2222-4222-8222-222222222222" },
    { ...created(), role: "platform_admin" },
  ])(
    "rejects and revokes a newly authenticated identity or portal mismatch",
    async (result) => {
      vi.spyOn(AdminGovernanceService, "login").mockResolvedValue(
        result as AdminLoginResult,
      );
      const record = vi
        .spyOn(
          AdminGovernanceService as unknown as {
            recordAttempt: (
              email: string,
              ip: string,
              status: string,
            ) => Promise<void>;
          },
          "recordAttempt",
        )
        .mockResolvedValue();
      expect(await confirm()).toEqual({ status: "invalid_credentials" });
      expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith(
        "local-auth-result-not-a-real-token",
        "local",
      );
      expect(record).toHaveBeenCalledWith(
        canonicalEmail,
        "synthetic-ip-hash",
        "failure",
      );
    },
  );
});
