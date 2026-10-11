import { randomUUID, createHash } from "node:crypto";
import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), rpc: vi.fn(), send: vi.fn() }));
vi.mock("../../server/config/runtime.ts", async (original) => {
  const actual = await original<typeof import("../../server/config/runtime.ts")>();
  return { ...actual, runtime: { ...actual.runtime, serviceKey: "local-fixture-signing-key" } };
});
vi.mock("../../server/db/pool.ts", () => ({ dbPool: {
  query: m.query,
  connect: async () => ({ query: async () => ({ rowCount: 1, rows: [] }), release() {} }),
} }));
vi.mock("../../server/supabase/client.ts", () => ({ supabaseAdmin: { rpc: m.rpc }, createSupabasePublicClient: () => ({ auth: { signInWithOtp: m.send } }) }));
vi.mock("../../server/middleware/adminSession.ts", () => ({
  adminSessionMiddleware: (req: any, _res: unknown, next: () => void) => { req.adminActor = { userId: "11111111-1111-4111-8111-111111111111", role: "platform_super_admin" }; next(); },
  requireAdminSector: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRecentAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/security/originProtection.ts", () => ({ originProtection: (_req: unknown, _res: unknown, next: () => void) => next() }));
import { adminAccountReviewRouter } from "../../server/routes/adminAccountReviewRoutes.ts";
const app = express(); app.use(express.json()); app.use(adminAccountReviewRouter);
const uid = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  vi.resetAllMocks();
  m.query.mockResolvedValue({rows:[{user_id:uid,email_normalized:"real-mailbox@example.invalid",role:"producer"}]});
  m.rpc.mockResolvedValue({data:true,error:null}); m.send.mockResolvedValue({error:null});
});
const approve = () => request(app).post("/registration-reviews/33333333-3333-4333-8333-333333333333/decision").send({decision:"approved",note:"Approval local fixture",commandId:randomUUID()});
it("approval delivers a one-use proof for the approved portal to the real mailbox", async () => {
  expect((await approve()).body).toMatchObject({status:"reviewed",confirmationSent:true});
  const sent = m.send.mock.calls[0][0];
  expect(sent.email).toBe("real-mailbox@example.invalid");
  const url = new URL(sent.options.emailRedirectTo), flow = url.searchParams.get("flow")!;
  expect(url.searchParams.get("portal")).toBe("producer"); expect(flow.length).toBeGreaterThanOrEqual(32);
  expect(m.rpc).toHaveBeenCalledWith("fn_issue_public_portal_email_flow", {p_user:uid,p_role:"producer",p_purpose:"confirmation",p_digest:createHash("sha256").update(flow).digest("hex")});
  expect(m.query.mock.calls.some(([sql])=>sql.includes("SET confirmation_sent_at"))).toBe(true);
});
it("SMTP failure preserves retry without marking the confirmation as sent", async () => {
  m.send.mockResolvedValue({error:{status:503}});
  expect((await approve()).body.confirmationSent).toBe(false);
  expect(m.query.mock.calls.some(([sql])=>sql.includes("SET confirmation_sent_at"))).toBe(false);
});
it("proof creation failure does not dispatch an unusable link", async () => {
  m.rpc.mockResolvedValue({data:false,error:null});
  expect((await approve()).body.confirmationSent).toBe(false); expect(m.send).not.toHaveBeenCalled();
});
