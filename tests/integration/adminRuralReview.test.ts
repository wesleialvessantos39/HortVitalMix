import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
}));
vi.mock("../../server/db/pool.ts", () => ({
  dbPool: { query: mocks.query, connect: mocks.connect },
}));
vi.mock("../../server/middleware/adminSession.ts", () => ({
  adminSessionMiddleware: (q: any, s: any, n: any) => {
    if (!q.headers["x-role"]) {
      s.sendStatus(401);
      return;
    }
    q.adminActor = {
      userId: "11111111-1111-4111-8111-111111111111",
      role: q.headers["x-role"],
      isSuperAdmin: q.headers["x-role"] === "platform_super_admin",
      sectors: q.headers["x-sector"] ? [q.headers["x-sector"]] : [],
    };
    q.requestId = "33333333-3333-4333-8333-333333333333";
    q.clientIpHash = "hash";
    n();
  },
  requireRecentAuth: (q: any, s: any, n: any) =>
    q.headers["x-stale"] ? s.sendStatus(401) : n(),
}));
vi.mock("../../server/security/originProtection.ts", () => ({
  originProtection: (_q: any, _s: any, n: any) => n(),
}));
import { adminRuralPropertyRouter } from "../../server/routes/adminRuralPropertyRoutes.ts";
const app = express();
app.use(express.json());
app.use(adminRuralPropertyRouter);
const id = "22222222-2222-4222-8222-222222222222";
const body = {
  decision: "verified",
  expectedRevision: 1,
  commandId: "44444444-4444-4444-8444-444444444444",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue({
    query: mocks.query,
    release: mocks.release,
  });
  mocks.query.mockImplementation(async (sql: string) => ({
    rows: sql.startsWith("UPDATE")
      ? [{ id, status: "verified", revision: 2 }]
      : [],
  }));
});
it("rejects unauthenticated reads", async () => {
  expect((await request(app).get("/rural-properties")).status).toBe(401);
  expect(mocks.query).not.toHaveBeenCalled();
});
it("requires the document verification sector for a sector admin", async () => {
  expect(
    (
      await request(app)
        .get("/rural-properties")
        .set("x-role", "platform_admin")
        .set("x-sector", "finance_ops")
    ).status,
  ).toBe(403);
  expect(mocks.query).not.toHaveBeenCalled();
});
it("lets assigned administrators read the review queue", async () => {
  const response = await request(app)
    .get("/rural-properties")
    .set("x-role", "platform_admin")
    .set("x-sector", "document_verification");
  expect(response.status).toBe(200);
  expect(mocks.query.mock.calls[0][0]).toContain("p.deleted_at IS NULL");
});
it("requires recent authentication for a decision", async () => {
  expect(
    (
      await request(app)
        .post("/rural-properties/" + id + "/review")
        .set("x-role", "platform_super_admin")
        .set("x-stale", "1")
        .send(body)
    ).status,
  ).toBe(401);
  expect(mocks.connect).not.toHaveBeenCalled();
});
it("requires a reason before returning a property", async () => {
  expect(
    (
      await request(app)
        .post("/rural-properties/" + id + "/review")
        .set("x-role", "platform_super_admin")
        .send({ ...body, decision: "rejected" })
    ).status,
  ).toBe(422);
});
it("commits and audits a valid decision", async () => {
  expect(
    (
      await request(app)
        .post("/rural-properties/" + id + "/review")
        .set("x-role", "platform_super_admin")
        .send(body)
    ).status,
  ).toBe(200);
  expect(mocks.query).toHaveBeenCalledWith(
    expect.stringContaining("app_audit_events"),
    expect.arrayContaining([body.commandId, id]),
  );
  expect(mocks.query).toHaveBeenCalledWith("COMMIT");
});
it("rolls back a stale revision instead of overwriting", async () => {
  mocks.query.mockResolvedValue({ rows: [] });
  expect(
    (
      await request(app)
        .post("/rural-properties/" + id + "/review")
        .set("x-role", "platform_super_admin")
        .send(body)
    ).status,
  ).toBe(409);
  expect(mocks.query).toHaveBeenCalledWith("ROLLBACK");
});
