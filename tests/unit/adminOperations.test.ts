import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminActorContext } from "../../server/middleware/adminSession.ts";
import {
  AdminCatalogQuerySchema,
  AdminFinanceQuerySchema,
  AdminCatalogResponseSchema,
  AdminFinanceResponseSchema,
} from "../../shared/contracts/adminOperations.ts";

const mock = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  release: vi.fn(),
  actor: null as unknown,
}));
vi.mock("../../server/db/pool.ts", () => ({
  dbPool: { connect: mock.connect },
}));
vi.mock("../../server/middleware/adminSession.ts", async (original) => {
  const actual =
    await original<typeof import("../../server/middleware/adminSession.ts")>();
  return {
    ...actual,
    adminSessionMiddleware: (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (req.headers.authorization !== "Bearer synthetic-operations") {
        res.status(401).json({ error: "UNAUTHORIZED" });
        return;
      }
      req.adminActor = mock.actor as AdminActorContext;
      next();
    },
  };
});
import { AdminOperationsService } from "../../server/services/AdminOperationsService.ts";
import { adminOperationsRouter } from "../../server/routes/adminOperationsRoutes.ts";
const actor = (extra: Partial<AdminActorContext> = {}): AdminActorContext => ({
  userId: "11111111-1111-4111-8111-111111111111",
  role: "platform_admin",
  sectors: [],
  isSuperAdmin: false,
  sessionIssuedAt: new Date().toISOString(),
  ...extra,
});
const finance = {
  generatedAt: "2026-10-09T02:00:00+00:00",
  view: "payments",
  period: { from: "2026-09-09", to: "2026-10-08" },
  pagination: { page: 1, pageSize: 20, total: 0 },
  metrics: {
    approvedPayments: 2,
    approvedAmountCents: 21000,
    heldAmountCents: 7000,
    releasedAmountCents: 12000,
  },
  payments: [],
  orders: [],
};
const catalog = {
  generatedAt: "2026-10-09T02:00:00+00:00",
  view: "products",
  pagination: { page: 1, pageSize: 20, total: 0 },
  metrics: {
    publishedProducts: 10,
    draftProducts: 2,
    visibleProducts: 7,
    activeStores: 3,
    activeCategories: 4,
  },
  products: [],
  stores: [],
  categories: [],
};
function app() {
  const value = express();
  for (const prefix of ["/v1/admin", "/api/v1/admin", "/_hvm_api/v1/admin"])
    value.use(prefix, adminOperationsRouter);
  return value;
}
beforeEach(() => {
  mock.query.mockReset().mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT 1 FROM public.app_users"))
      return { rows: [{ allowed: 1 }], rowCount: 1 };
    if (sql.includes("AS response"))
      return {
        rows: [
          { response: sql.includes("period_payments") ? finance : catalog },
        ],
        rowCount: 1,
      };
    return { rows: [], rowCount: 0 };
  });
  mock.release.mockReset();
  mock.connect
    .mockReset()
    .mockResolvedValue({ query: mock.query, release: mock.release });
  mock.actor = actor();
});

describe("Departamentos operacionais: limites e autorização", () => {
  it.each(["finance", "catalog"] as const)(
    "nega %s antes de qualquer conexão de banco",
    async (kind) => {
      await expect(AdminOperationsService[kind](actor())).rejects.toMatchObject(
        { code: "FORBIDDEN", status: 403 },
      );
      expect(mock.connect).not.toHaveBeenCalled();
      expect(mock.query).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["finance", "finance_ops"],
    ["catalog", "catalog_moderation"],
  ] as const)(
    "nega override mesmo para super no departamento %s",
    async (kind, sector) => {
      await expect(
        AdminOperationsService[kind](
          actor({
            role: "platform_super_admin",
            isSuperAdmin: true,
            sectors: [sector],
            deniedSectors: [sector],
          }),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(mock.connect).not.toHaveBeenCalled();
    },
  );
  it("revalida poderes canônicos antes de consultar dados mesmo se o actor estava permitido", async () => {
    mock.query.mockImplementation(async (sql: string) => ({
      rows: [],
      rowCount: sql.startsWith("SELECT 1 FROM public.app_users")
        ? 0
        : undefined,
    }));
    await expect(
      AdminOperationsService.finance(actor({ sectors: ["finance_ops"] })),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(
      mock.query.mock.calls.map((call) => call[0]).join(" "),
    ).not.toContain("period_payments");
    expect(mock.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mock.release).toHaveBeenCalled();
  });
  it("usa o dia operacional de Cuiabá em vez de antecipar a data UTC e restringe o período", async () => {
    const result = await AdminOperationsService.finance(
      actor({ sectors: ["finance_ops"] }),
      {},
      new Date("2026-10-09T02:00:00Z"),
    );
    expect(result.metrics.approvedAmountCents).toBe(21000);
    const call = mock.query.mock.calls.find((call) =>
      String(call[0]).includes("AS response"),
    )!;
    expect(call[1].slice(0, 2)).toEqual(["2026-09-09", "2026-10-08"]);
    expect(call[0]).toContain("AT TIME ZONE 'America/Cuiaba'");
    expect(mock.query).toHaveBeenCalledWith("COMMIT");
  });
  it("busca texto literal e nunca interpola parâmetros nem amplia campos pessoais", async () => {
    await AdminOperationsService.catalog(
      actor({ sectors: ["catalog_moderation"] }),
      { search: "%_' OR 1=1 --", pageSize: 50, page: 2 },
    );
    const call = mock.query.mock.calls.find((call) =>
      String(call[0]).includes("AS response"),
    )!;
    expect(call[0]).not.toContain("OR 1=1 --");
    expect(call[1][0]).toBe("%\\%\\_' OR 1=1 --%");
    expect(call[1].slice(3, 5)).toEqual([50, 50]);
    for (const field of [
      "cpf",
      "email_normalized",
      "address_snapshot",
      "gateway_reference",
      "raw_payload",
    ])
      expect(call[0]).not.toContain(field);
  });
  it.each([
    { pageSize: 51 },
    { page: 0 },
    { search: "x".repeat(81) },
    { unexpected: true },
  ])("filtro de catálogo inválido não inicia transação: %j", async (input) => {
    await expect(
      AdminOperationsService.catalog(
        actor({ sectors: ["catalog_moderation"] }),
        input,
      ),
    ).rejects.toMatchObject({ code: "DEPARTMENT_FILTER_INVALID", status: 400 });
    expect(mock.connect).not.toHaveBeenCalled();
  });
  it.each([
    { from: "2026-02-30" },
    { from: "2026-10-10", to: "2026-10-01" },
    { from: "2024-01-01", to: "2026-01-01" },
    { pageSize: 100 },
  ])("período/filtro financeiro inválido: %j", async (input) => {
    await expect(
      AdminOperationsService.finance(
        actor({ sectors: ["finance_ops"] }),
        input,
      ),
    ).rejects.toMatchObject({ code: "DEPARTMENT_FILTER_INVALID" });
    expect(mock.connect).not.toHaveBeenCalled();
  });
  it("contratos aceitam o timestamptz real do Postgres e rejeitam valores financeiros negativos", () => {
    expect(AdminFinanceResponseSchema.safeParse(finance).success).toBe(true);
    expect(AdminCatalogResponseSchema.safeParse(catalog).success).toBe(true);
    expect(
      AdminFinanceResponseSchema.safeParse({
        ...finance,
        metrics: { ...finance.metrics, heldAmountCents: -1 },
      }).success,
    ).toBe(false);
    expect(
      AdminFinanceQuerySchema.safeParse({
        from: "2026-01-01",
        to: "2027-01-01",
      }).success,
    ).toBe(true);
    expect(
      AdminCatalogQuerySchema.safeParse({ publication: "approved" }).success,
    ).toBe(false);
  });
});

describe("HTTP operacional", () => {
  it.each(["/v1/admin", "/api/v1/admin", "/_hvm_api/v1/admin"])(
    "protege os dois endpoints no prefixo %s e todas as respostas são no-store",
    async (prefix) => {
      for (const path of ["/finance/overview", "/catalog/overview"]) {
        const result = await request(app()).get(prefix + path);
        expect(result.status).toBe(401);
        expect(result.headers["cache-control"]).toContain("no-store");
      }
      expect(mock.connect).not.toHaveBeenCalled();
    },
  );
  it("não entrega financeiro para poder de catálogo nem catálogo para poder financeiro", async () => {
    for (const [sector, path] of [
      ["catalog_moderation", "/finance/overview"],
      ["finance_ops", "/catalog/overview"],
    ] as const) {
      mock.actor = actor({ sectors: [sector] });
      const result = await request(app())
        .get("/v1/admin" + path)
        .set("Authorization", "Bearer synthetic-operations");
      expect(result.status).toBe(403);
    }
    expect(mock.connect).not.toHaveBeenCalled();
  });
  it("lista autorizada mostra somente DTO e não cacheia identidade anterior", async () => {
    mock.actor = actor({ sectors: ["finance_ops"] });
    const result = await request(app())
      .get("/api/v1/admin/finance/overview")
      .set("Authorization", "Bearer synthetic-operations");
    expect(result.status).toBe(200);
    expect(result.body.metrics.approvedAmountCents).toBe(21000);
    expect(result.headers["cache-control"]).toContain("no-store");
    expect(JSON.stringify(result.body)).not.toContain(
      (mock.actor as AdminActorContext).userId,
    );
  });
  it.each([
    ["finance_ops", "/finance/overview"],
    ["catalog_moderation", "/catalog/overview"],
  ] as const)(
    "resposta SQL incompleta em %s é falha do departamento, não erro de preenchimento",
    async (sector, path) => {
      mock.actor = actor({ sectors: [sector] });
      mock.query.mockImplementation(async (sql: string) => {
        if (sql.startsWith("SELECT 1 FROM public.app_users"))
          return { rows: [{ allowed: 1 }], rowCount: 1 };
        if (sql.includes("AS response"))
          return { rows: [{ response: { generatedAt: finance.generatedAt } }] };
        return { rows: [], rowCount: 0 };
      });
      const result = await request(app())
        .get("/v1/admin" + path)
        .set("Authorization", "Bearer synthetic-operations");
      expect(result.status).toBe(503);
      expect(result.body.error).toBe("DEPARTMENT_UNAVAILABLE");
      expect(result.body).not.toHaveProperty("metrics");
      expect(result.headers["cache-control"]).toContain("no-store");
      expect(mock.query).toHaveBeenCalledWith("ROLLBACK");
      expect(mock.release).toHaveBeenCalled();
    },
  );
  it("falha de banco retorna indisponível sem transformar dados ausentes em zeros", async () => {
    mock.actor = actor({ sectors: ["catalog_moderation"] });
    mock.connect.mockRejectedValueOnce(new Error("offline"));
    const result = await request(app())
      .get("/v1/admin/catalog/overview")
      .set("Authorization", "Bearer synthetic-operations");
    expect(result.status).toBe(503);
    expect(result.body).not.toHaveProperty("metrics");
  });
});
