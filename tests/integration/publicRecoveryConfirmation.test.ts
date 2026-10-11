import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ resolve: vi.fn(), confirm: vi.fn(), reset: vi.fn() }));
vi.mock("../../server/db/pool.ts", () => ({ dbPool: null }));
vi.mock("../../server/supabase/client.ts", () => ({ supabaseAdmin: { auth: { admin: { updateUserById: m.confirm } } }, supabasePublic: null, createSupabasePublicClient: () => null }));
vi.mock("../../server/services/RoleSecurityService.ts", async original => ({ ...await original<typeof import("../../server/services/RoleSecurityService.ts")>(), resolveRecoveryChallenge: m.resolve }));
vi.mock("../../server/services/PublicPortalCredentialsService.ts", async original => ({ ...await original<typeof import("../../server/services/PublicPortalCredentialsService.ts")>(), resetPublicPortalPassword: m.reset }));
import { authRouter } from "../../server/routes/authRoutes.ts";
const app = express(); app.use(express.json()); app.use(authRouter);
const uid = "11111111-1111-4111-8111-111111111111";
const input = { portalRole: "consumer", flowToken: "a".repeat(43), password: "NewScopedPassword!2026" };
beforeEach(() => { vi.resetAllMocks(); m.resolve.mockResolvedValue({ userId: uid }); m.confirm.mockResolvedValue({error:null}); m.reset.mockResolvedValue(true); });
it("recovery of an internal public identity also confirms its mailbox transport without changing its Auth password", async () => {
  expect((await request(app).post("/reset-password").send(input)).status).toBe(204);
  expect(m.confirm).toHaveBeenCalledWith(uid,{email_confirm:true});
  expect(m.reset).toHaveBeenCalledWith(uid,"consumer",input.password,input.flowToken);
  expect(m.confirm.mock.invocationCallOrder[0]).toBeLessThan(m.reset.mock.invocationCallOrder[0]);
});
it("an Auth outage preserves the recovery proof and the old portal password", async () => {
  m.confirm.mockResolvedValue({error:{status:503}});
  expect((await request(app).post("/reset-password").send(input)).status).toBe(503); expect(m.reset).not.toHaveBeenCalled();
});
it("an invalid recovery flow never confirms an identity or changes a password", async () => {
  m.resolve.mockResolvedValue(null);
  expect((await request(app).post("/reset-password").send(input)).status).toBe(410); expect(m.confirm).not.toHaveBeenCalled(); expect(m.reset).not.toHaveBeenCalled();
});
