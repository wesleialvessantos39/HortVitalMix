import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminActorContext } from "../../server/middleware/adminSession.ts";
import { AdminSectorCodeSchema } from "../../shared/contracts/adminGovernance.ts";
import { AdminDashboardResponseSchema } from "../../shared/contracts/adminDashboard.ts";

const mock = vi.hoisted(() => ({ query: vi.fn(), actor: null as unknown }));
vi.mock("../../server/db/pool.ts", () => ({ dbPool: { query: mock.query } }));
vi.mock("../../server/middleware/adminSession.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/middleware/adminSession.ts")>();
  return {
    ...actual,
    adminSessionMiddleware: async (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.headers.authorization === "Bearer synthetic-dashboard-session") {
        req.adminActor = mock.actor as AdminActorContext;
        next();
      } else await actual.adminSessionMiddleware(req, res, next);
    },
  };
});

import { AdminDashboardService } from "../../server/services/AdminDashboardService.ts";
import { adminDashboardRouter } from "../../server/routes/adminDashboardRoutes.ts";
import { adminConfigRouter } from "../../server/routes/adminConfigRoutes.ts";
import { ConfigurationService } from "../../server/services/ConfigurationService.ts";

const actor = (input: Partial<AdminActorContext> = {}): AdminActorContext => ({
  userId: "11111111-1111-4111-8111-111111111111", role: "platform_admin", sectors: [],
  deniedSectors: [], isSuperAdmin: false, sessionIssuedAt: new Date().toISOString(), ...input,
});
const row = {
  generated_at: new Date("2026-10-08T12:00:00Z"), audit_events_24h: "24",
  account_governance: { active_users: 14, blocked_users: 2, pending_registrations: 3, pending_invites: 4 },
  document_verification: { verified_properties: 7, total_properties: 9, verification_queue: 2, documents_processing: 1, document_failures: 0 },
  catalog_moderation: { published_products: 25, draft_products: 8, active_categories: 4, active_stores: 3 },
  location_management: { active_municipalities: 5, blocked_municipalities: 1, active_access_blocks: 2 },
  finance_ops: { approved_payments: 6, approved_amount: 76500, held_amount: 15000, released_amount: 41500 },
  refund_management: { pending_refunds: 2, processing_refunds: 1, confirmed_refunds: 3, requested_amount: 5600 },
  complaint_management: { open_complaints: 3, resolved_complaints: 7, visible_reviews: 19, moderated_reviews: 1 },
  payment_configuration: { pending_payments: 2, failed_payments: 1, active_subscriptions: 12, past_due_subscriptions: 2, active_plans: 3 },
  platform_configuration: { config_revision: 8, config_changes_24h: 1, active_kpis: 8 },
};
const app = () => {
  const result = express();
  result.use((req, _res, next) => { req.requestId = randomUUID(); next(); });
  for (const prefix of ["/v1/admin", "/api/v1/admin", "/_hvm_api/v1/admin"]) {
    result.use(prefix, adminDashboardRouter);
    result.use(prefix, adminConfigRouter);
  }
  return result;
};

beforeEach(() => {
  vi.restoreAllMocks();
  mock.query.mockReset().mockResolvedValue({ rows: [row] });
  mock.actor = actor();
});

describe("Indicadores reais por poder administrativo", () => {
  it.each(AdminSectorCodeSchema.options)("consulta e apresenta apenas o departamento %s", async (sector) => {
    const result = await AdminDashboardService.overview(actor({ sectors: [sector] }));
    expect(result.scope.sectors).toEqual([sector]);
    expect(result.departments.map((department) => department.sector)).toEqual([sector]);
    expect(result.departments[0].metrics.every((metric) => metric.value >= 0)).toBe(true);
    const sql = mock.query.mock.calls[0][0] as string;
    for (const other of AdminSectorCodeSchema.options.filter((code) => code !== sector))
      expect(sql).not.toContain(" AS " + other);
    expect(result.generatedAt).toBe("2026-10-08T12:00:00.000Z");
    expect(mock.query).toHaveBeenCalledTimes(1);
  });

  it("super administrador abrangente recebe os nove departamentos e auditoria global", async () => {
    const result = await AdminDashboardService.overview(actor({ role: "platform_super_admin", isSuperAdmin: true }));
    expect(result.departments).toHaveLength(9);
    expect(result.departments.find((department) => department.sector === "platform_configuration")?.metrics)
      .toContainEqual(expect.objectContaining({ key: "audit_events_24h", value: 24 }));
    expect(result.departments.find((department) => department.sector === "catalog_moderation")?.actionPath).toBe("/admin/catalogo");
    expect(result.departments.find((department) => department.sector === "finance_ops")?.actionPath).toBe("/admin/financeiro");
  });

  it("poder negado de super administrador exclui agregado, métricas e auditoria global", async () => {
    const result = await AdminDashboardService.overview(actor({
      role: "platform_super_admin", isSuperAdmin: true,
      deniedSectors: ["finance_ops", "payment_configuration", "account_governance"],
    }));
    expect(result.departments).toHaveLength(6);
    expect(result.scope.sectors).not.toContain("finance_ops");
    expect(result.scope.sectors).not.toContain("payment_configuration");
    expect(result.scope.sectors).not.toContain("account_governance");
    const sql = mock.query.mock.calls[0][0] as string;
    expect(sql).not.toContain("app_payment_intents");
    expect(sql).not.toContain("app_financial_holds");
    expect(sql).not.toContain("app_users");
    expect(sql).not.toContain("AS audit_events_24h");
    expect(result.departments.flatMap((department) => department.metrics).map((metric) => metric.key)).not.toContain("audit_events_24h");
  });

  it("negação prevalece sobre setor concedido e não inventa números para conta sem poderes", async () => {
    const result = await AdminDashboardService.overview(actor({ sectors: ["account_governance"], deniedSectors: ["account_governance"] }));
    expect(result.departments).toEqual([]);
    expect(result.scope.sectors).toEqual([]);
    expect(mock.query.mock.calls[0][0]).not.toContain("app_users");
  });

  it("convites respeitam proprietário e expirados/arquivados não entram na pendência", async () => {
    const current = actor({ sectors: ["account_governance"] });
    const result = await AdminDashboardService.overview(current);
    expect(mock.query.mock.calls[0][1]).toEqual([current.userId, false]);
    const sql = mock.query.mock.calls[0][0] as string;
    expect(sql).toContain("a.is_super OR i.invited_by=a.user_id");
    expect(sql).toContain("i.expires_at>now()");
    expect(sql).toContain("admin.invite.archived");
    expect(result.departments[0].metrics).toContainEqual(expect.objectContaining({ key: "pending_invites", value: 4 }));
  });

  it("usa valores consultados e sinaliza atenção apenas quando há pendência", async () => {
    const result = await AdminDashboardService.overview(actor({ sectors: ["finance_ops", "document_verification"] }));
    const metrics = result.departments.flatMap((department) => department.metrics);
    expect(metrics).toContainEqual(expect.objectContaining({ key: "approved_amount", value: 76500, unit: "currency_cents" }));
    expect(metrics).toContainEqual(expect.objectContaining({ key: "verification_queue", value: 2, attention: true }));
    expect(metrics).toContainEqual(expect.objectContaining({ key: "document_failures", value: 0, attention: false }));
  });

  it("falha de banco ou resposta incompleta não vira indicador zero", async () => {
    mock.query.mockRejectedValueOnce(new Error("database_unavailable"));
    await expect(AdminDashboardService.overview(actor({ sectors: ["finance_ops"] }))).rejects.toThrow("database_unavailable");
    mock.query.mockResolvedValueOnce({ rows: [{ generated_at: row.generated_at }] });
    await expect(AdminDashboardService.overview(actor({ sectors: ["finance_ops"] }))).rejects.toThrow("DASHBOARD_INCOMPLETE");
    expect(AdminDashboardResponseSchema.safeParse({ ...row, departments: [{ sector: "finance_ops", metrics: [{ value: -1 }] }] }).success).toBe(false);
  });
});

describe("Fronteira HTTP do painel", () => {
  it.each(["/v1/admin", "/api/v1/admin", "/_hvm_api/v1/admin"])("exige sessão no prefixo %s", async (prefix) => {
    const result = await request(app()).get(prefix + "/dashboard");
    expect(result.status).toBe(401);
    expect(mock.query).not.toHaveBeenCalled();
  });

  it("resposta privada não admite cache nem campos de identidade pessoais", async () => {
    mock.actor = actor({ sectors: ["location_management"] });
    const result = await request(app()).get("/v1/admin/dashboard").set("Authorization", "Bearer synthetic-dashboard-session");
    expect(result.status).toBe(200);
    expect(result.headers["cache-control"]).toContain("no-store");
    expect(result.body.scope.sectors).toEqual(["location_management"]);
    expect(JSON.stringify(result.body)).not.toContain((mock.actor as AdminActorContext).userId);
  });

  it("erro de consulta é 503 com opção de atualização, sem falso sucesso", async () => {
    mock.query.mockRejectedValueOnce(new Error("database_unavailable"));
    mock.actor = actor({ sectors: ["location_management"] });
    const result = await request(app()).get("/v1/admin/dashboard").set("Authorization", "Bearer synthetic-dashboard-session");
    expect(result.status).toBe(503);
    expect(result.body.error).toBe("DASHBOARD_UNAVAILABLE");
    expect(result.body).not.toHaveProperty("departments");
  });

  it("endpoint legado deixa de expor departamentos com uma única permissão de configuração", async () => {
    const spy = vi.spyOn(ConfigurationService, "getOverview");
    mock.actor = actor({ sectors: ["platform_configuration"] });
    const result = await request(app()).get("/v1/admin/configuration/overview").set("Authorization", "Bearer synthetic-dashboard-session");
    expect(result.status).toBe(410);
    expect(result.body.dashboardPath).toBe("/v1/admin/dashboard");
    expect(result.body).not.toHaveProperty("activeUsers");
    expect(spy).not.toHaveBeenCalled();
    expect(mock.query).not.toHaveBeenCalled();
  });
});
