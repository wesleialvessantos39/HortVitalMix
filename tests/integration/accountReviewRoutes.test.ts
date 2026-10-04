import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  targetStatus: "active",
  superTarget: false,
  reviewStatus: "pending",
  accountStatus: "pending",
  fail: false,
}));
vi.mock("../../server/db/pool.ts", () => ({
  dbPool: { connect: async () => m, query: m.query },
}));
vi.mock("../../server/middleware/adminSession.ts", () => ({
  adminSessionMiddleware: (q: any, _s: any, n: any) => {
    q.adminActor = {
      userId: "11111111-1111-4111-8111-111111111111",
      role: q.headers["x-role"],
      sectors: [],
      isSuperAdmin: q.headers["x-role"] === "platform_super_admin",
    };
    q.requestId = "33333333-3333-4333-8333-333333333333";
    q.clientIpHash = "a".repeat(64);
    n();
  },
  requireSuperAdmin: (q: any, s: any, n: any) =>
    q.adminActor.isSuperAdmin ? n() : s.sendStatus(403),
  requireAdminSector: () => (q: any, s: any, n: any) =>
    q.adminActor.isSuperAdmin ? n() : s.sendStatus(403),
  requireRecentAuth: (q: any, s: any, n: any) =>
    q.headers["x-stale"] ? s.sendStatus(401) : n(),
}));
vi.mock("../../server/security/originProtection.ts", () => ({
  originProtection: (_q: any, _s: any, n: any) => n(),
}));
import { adminAccountReviewRouter } from "../../server/routes/adminAccountReviewRoutes";
const app = express();
app.use(express.json());
app.use(adminAccountReviewRouter);
const id = "22222222-2222-4222-8222-222222222222",
  body = { commandId: id };
beforeEach(() => {
  vi.clearAllMocks();
  m.targetStatus = "active";
  m.superTarget = false;
  m.reviewStatus = "pending";
  m.accountStatus = "pending";
  m.fail = false;
  m.query.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT u.status,p.cpf_normalized"))
      return {
        rows: [
          {
            status: m.targetStatus,
            cpf_normalized: "00000000000",
            full_name: "Fixture",
            is_super: m.superTarget,
          },
        ],
        rowCount: 1,
      };
    if (sql.includes("SELECT r.*,u.status"))
      return {
        rows: [
          {
            id,
            user_id: id,
            status: m.reviewStatus,
            account_status: m.accountStatus,
          },
        ],
        rowCount: 1,
      };
    if (m.fail && sql.startsWith("UPDATE public.app_people"))
      throw Object.assign(new Error("fixture"), { code: "23505" });
    return { rows: [], rowCount: 0 };
  });
});
const deletion = () =>
  request(app)
    .post("/users/" + id + "/delete")
    .set("x-role", "platform_super_admin");
const review = () =>
  request(app)
    .post("/registration-reviews/" + id + "/decision")
    .set("x-role", "platform_super_admin");
it("restricts deletion and review to super administrators", async () => {
  expect(
    (
      await request(app)
        .post("/users/" + id + "/delete")
        .set("x-role", "platform_admin")
        .send(body)
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app)
        .get("/registration-reviews")
        .set("x-role", "platform_admin")
    ).status,
  ).toBe(403);
  expect(m.query).not.toHaveBeenCalled();
});
it("requires recent authentication", async () => {
  expect((await deletion().set("x-stale", "1").send(body)).status).toBe(401);
  expect(
    (
      await review()
        .set("x-stale", "1")
        .send({ ...body, decision: "approved", note: "Identidade conferida" })
    ).status,
  ).toBe(401);
});
it("revokes sessions, preserves tombstone/audit and calls the v46 operational deletion", async () => {
  expect((await deletion().send(body)).status).toBe(200);
  for (const part of [
    "status='deleted'",
    "archived_at=now()",
    "DELETE FROM auth.sessions",
    "'account.deleted'",
    "public.delete_active_account",
  ])
    expect(m.query.mock.calls.some(([sql]) => sql.includes(part))).toBe(true);
  expect(m.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  expect(m.release).toHaveBeenCalledOnce();
});
it("protects super administrator identities", async () => {
  m.superTarget = true;
  expect((await deletion().send(body)).status).toBe(409);
  expect(m.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(
    false,
  );
});
it("approves a pending account and records the decision", async () => {
  expect(
    (
      await review().send({
        ...body,
        decision: "approved",
        note: "Documentos e identidade conferidos",
      })
    ).status,
  ).toBe(200);
  expect(
    m.query.mock.calls.some(([sql]) => sql.includes("status='active'")),
  ).toBe(true);
  expect(m.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
});
it("rejects without releasing access", async () => {
  expect(
    (
      await review().send({
        ...body,
        decision: "rejected",
        note: "Identidade não comprovada",
      })
    ).status,
  ).toBe(200);
  expect(
    m.query.mock.calls.some(([sql]) => sql.includes("status='active'")),
  ).toBe(false);
  expect(
    m.query.mock.calls.some(([sql]) => sql.includes("status='suspended'")),
  ).toBe(true);
});
it("rolls back if restoring an archived identity conflicts with a current CPF", async () => {
  m.fail = true;
  expect(
    (await review().send({ ...body, decision: "approved", note: "Conferido" }))
      .status,
  ).toBe(409);
  expect(m.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
});
it("does not override another decision or an already active account", async () => {
  m.reviewStatus = "rejected";
  expect(
    (await review().send({ ...body, decision: "approved", note: "Conferido" }))
      .status,
  ).toBe(409);
  m.reviewStatus = "pending";
  m.accountStatus = "active";
  expect(
    (await review().send({ ...body, decision: "approved", note: "Conferido" }))
      .status,
  ).toBe(409);
});
