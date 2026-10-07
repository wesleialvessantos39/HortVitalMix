import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("../../server/config/runtime.ts", async (original) => {
  const actual =
    await original<typeof import("../../server/config/runtime.ts")>();
  return {
    ...actual,
    runtime: {
      ...actual.runtime,
      ipPepper: "t25-local-unit",
      appEnv: "development",
    },
  };
});
vi.mock("../../server/middleware/adminSession.ts", async (original) => {
  const actual =
    await original<typeof import("../../server/middleware/adminSession.ts")>();
  return {
    ...actual,
    adminSessionMiddleware: (req: any, res: any, next: any) => {
      const role = req.headers["x-test-admin-role"];
      if (!role) {
        res.status(401).json({ error: "UNAUTHORIZED" });
        return;
      }
      req.adminActor = {
        userId: uid,
        role,
        isSuperAdmin: role === "platform_super_admin",
        sectors: ["platform_configuration"],
        sessionIssuedAt: req.headers["x-test-old"]
          ? "2000-01-01T00:00:00Z"
          : new Date().toISOString(),
      };
      next();
    },
  };
});
import {
  offlineRouter,
  adminBiRouter,
} from "../../server/routes/offlineBiRoutes.ts";
import { OfflineSyncService } from "../../server/services/OfflineSyncService.ts";
import { KpiAggregationService } from "../../server/services/KpiAggregationService.ts";
import { issueRecentAuthProof } from "../../server/security/recentAuth.ts";
const uid = randomUUID(),
  token =
    "local." +
    Buffer.from(JSON.stringify({ session_id: randomUUID() })).toString(
      "base64url",
    ) +
    ".local";
function app(roles: string[] = []) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.actor = roles.length
      ? {
          userId: uid,
          roles,
          email: null,
          personId: randomUUID(),
          fullName: null,
        }
      : null;
    req.requestId = randomUUID();
    req.clientIpHash = "a".repeat(64);
    next();
  });
  for (const pre of ["/v1", "/api/v1", "/_hvm_api/v1"]) {
    a.use(pre, offlineRouter);
    a.use(pre + "/admin", adminBiRouter);
  }
  return a;
}
const batch = (commandType = "order.transition") => ({
  deviceFingerprint: "local-unit-device",
  commands: [
    { commandId: randomUUID(), commandType, baseRevision: 1, payload: {} },
  ],
});
afterEach(() => vi.restoreAllMocks());
describe("T25 fronteiras HTTP e contratos dos três prefixos", () => {
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "reconciliação exige produtor e não aceita identidade em body: %s",
    async (pre) => {
      const spy = vi
        .spyOn(OfflineSyncService, "reconcileBatch")
        .mockResolvedValue({ results: [] });
      expect(
        (
          await request(app())
            .post(pre + "/producer/sync")
            .set("Sec-Fetch-Site", "same-origin")
            .send(batch())
        ).status,
      ).toBe(401);
      expect(
        (
          await request(app(["consumer"]))
            .post(pre + "/producer/sync")
            .set("Sec-Fetch-Site", "same-origin")
            .send(batch())
        ).status,
      ).toBe(403);
      const r = await request(app(["producer", "consumer"]))
        .post(pre + "/producer/sync")
        .set("Sec-Fetch-Site", "same-origin")
        .set("Cookie", "hvm_portal_role=producer")
        .send(batch());
      expect(r.status).toBe(200);
      expect(r.headers["cache-control"]).toContain("no-store");
      expect(spy).toHaveBeenCalledWith(
        "local-unit-device",
        uid,
        expect.any(Array),
        expect.objectContaining({ ipHash: "a".repeat(64) }),
      );
      expect(
        (
          await request(app(["producer"]))
            .post(pre + "/producer/sync")
            .set("Sec-Fetch-Site", "same-origin")
            .send({ ...batch(), userId: randomUUID() })
        ).status,
      ).toBe(422);
    },
  );
  it("colheita em lote mantém a prova recente T15", async () => {
    const spy = vi
      .spyOn(OfflineSyncService, "reconcileBatch")
      .mockResolvedValue({ results: [] });
    expect(
      (
        await request(app(["producer"]))
          .post("/v1/producer/sync")
          .set("Sec-Fetch-Site", "same-origin")
          .send(batch("inventory.harvest"))
      ).status,
    ).toBe(401);
    expect(spy).not.toHaveBeenCalled();
    const proof = issueRecentAuthProof(uid, token);
    expect(
      (
        await request(app(["producer"]))
          .post("/v1/producer/sync")
          .set("Sec-Fetch-Site", "same-origin")
          .set("Cookie", `hvm_access=${token}; hvm_reauth=${proof}`)
          .send(batch("inventory.harvest"))
      ).status,
    ).toBe(200);
  });
  it("origem externa não chega ao reconciliador", async () => {
    const spy = vi.spyOn(OfflineSyncService, "reconcileBatch");
    expect(
      (
        await request(app(["producer"]))
          .post("/v1/producer/sync")
          .set("Origin", "https://attacker.example")
          .set("Sec-Fetch-Site", "cross-site")
          .send(batch())
      ).status,
    ).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "BI restringe leitura a Super Admin: %s",
    async (pre) => {
      const spy = vi
        .spyOn(KpiAggregationService, "dashboard")
        .mockResolvedValue({} as any);
      expect((await request(app()).get(pre + "/admin/bi")).status).toBe(401);
      expect(
        (
          await request(app())
            .get(pre + "/admin/bi")
            .set("X-Test-Admin-Role", "platform_admin")
        ).status,
      ).toBe(403);
      const r = await request(app())
        .get(
          pre +
            "/admin/bi?startDate=2026-10-01&endDate=2026-10-07&path=ignored&__hvm_path=ignored",
        )
        .set("X-Test-Admin-Role", "platform_super_admin");
      expect(r.status).toBe(200);
      expect(r.headers["cache-control"]).toContain("private");
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ userId: uid }),
        { startDate: "2026-10-01", endDate: "2026-10-07" },
      );
    },
  );
  it("cálculo exige reautenticação recente e data estrita", async () => {
    const spy = vi
      .spyOn(KpiAggregationService, "calculateDailyKpis")
      .mockResolvedValue({ referenceDate: "2026-10-07", calculated: 8 });
    expect(
      (
        await request(app())
          .post("/v1/admin/bi/calculate")
          .set("X-Test-Admin-Role", "platform_super_admin")
          .set("X-Test-Old", "1")
          .set("Sec-Fetch-Site", "same-origin")
          .send({ referenceDate: "2026-10-07" })
      ).status,
    ).toBe(401);
    expect(spy).not.toHaveBeenCalled();
    expect(
      (
        await request(app())
          .post("/v1/admin/bi/calculate")
          .set("X-Test-Admin-Role", "platform_super_admin")
          .set("Sec-Fetch-Site", "same-origin")
          .send({ referenceDate: "2026-10-07", isSuperAdmin: true })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app())
          .post("/v1/admin/bi/calculate")
          .set("X-Test-Admin-Role", "platform_super_admin")
          .set("Sec-Fetch-Site", "same-origin")
          .send({ referenceDate: "2026-10-07" })
      ).status,
    ).toBe(200);
  });
});
