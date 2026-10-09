import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  updateUser: vi.fn(),
  login: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../../server/db/pool.ts", () => ({
  dbPool: {
    query: mocks.query,
    connect: async () => ({ query: mocks.query, release: mocks.release }),
  },
}));
vi.mock("../../server/supabase/client.ts", () => ({
  supabaseAdmin: { auth: { admin: { updateUserById: mocks.updateUser } } },
  supabasePublic: null,
  createSupabasePublicClient: () => ({
    auth: { signInWithPassword: mocks.login },
  }),
}));
import { AdminGovernanceService } from "../../server/services/AdminGovernanceService.ts";
const token = "a".repeat(64);
const row = (role: string, state: string) => ({
  id: "11111111-1111-4111-8111-111111111111",
  target_role: role,
  is_accepted: state === "already_accepted",
  invalidated_at: state === "invalidated" ? new Date().toISOString() : null,
  expires_at:
    state === "expired" ? "2020-01-01T00:00:00Z" : "2099-01-01T00:00:00Z",
});
beforeEach(() => vi.resetAllMocks());
for (const role of ["platform_admin", "platform_super_admin"]) {
  describe(`Unavailable ${role} links cannot create or import a session`, () => {
    for (const state of [
      "invalid",
      "expired",
      "invalidated",
      "already_accepted",
    ]) {
      it(`${state} validation is read only and reveals no identity`, async () => {
        mocks.query.mockResolvedValue({
          rows: state === "invalid" ? [] : [row(role, state)],
        });
        expect(await AdminGovernanceService.validateInviteToken(token)).toEqual(
          { status: state },
        );
        expect(
          mocks.query.mock.calls.every(([sql]) =>
            /^\s*SELECT/.test(String(sql)),
          ),
        ).toBe(true);
        expect(mocks.updateUser).not.toHaveBeenCalled();
        expect(mocks.login).not.toHaveBeenCalled();
      });
      it(`${state} acceptance cannot change passwords or create access`, async () => {
        mocks.query.mockImplementation(async (sql: string) => ({
          rows:
            /SELECT.*FROM public.app_admin_invites/s.test(sql) &&
            state !== "invalid"
              ? [row(role, state)]
              : [],
        }));
        const result = await AdminGovernanceService.acceptInvite(
          {
            token,
            fullName: "Pessoa Sintética",
            cpf: "52998224725",
            phone: "+5569999999999",
            password: "Synthetic!Password2026",
            commandId: "22222222-2222-4222-8222-222222222222",
          },
          "request",
          "ip",
        );
        expect(result.status).toBe(
          state === "invalid" || state === "invalidated"
            ? "invalid_token"
            : state,
        );
        expect(mocks.updateUser).not.toHaveBeenCalled();
        expect(mocks.login).not.toHaveBeenCalled();
        expect(JSON.stringify(result)).not.toContain("Token");
      });
    }
  });
}
