import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../server/security/recentAuth.ts", () => ({
  verifyRecentAuthProof: vi.fn(() => true),
}));
import { inventoryRouter } from "../../server/routes/inventoryRoutes.ts";
import {
  InventoryService,
  InventoryError,
} from "../../server/services/InventoryService.ts";
import { verifyRecentAuthProof } from "../../server/security/recentAuth.ts";
const id = randomUUID(),
  userId = randomUUID(),
  personId = randomUUID();
const input = () => ({
  lotCode: "L-01",
  harvestDate: "2026-10-05",
  expirationDate: "2026-10-10",
  quantity: 4,
  commandId: randomUUID(),
});
function app(role: string | null = "producer", person = true, vercel = false) {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    req.actor = role
      ? {
          userId,
          personId: person ? personId : null,
          email: "producer@example.test",
          fullName: "Produtor",
          roles: [role],
        }
      : null;
    req.requestId = randomUUID();
    req.clientIpHash = "b".repeat(64);
    if (vercel)
      Object.defineProperty(req, "query", {
        configurable: true,
        value: {
          path: ["v1", "producer", "products"],
          __hvm_path: "metadata",
          lotsPage: "999",
        },
      });
    next();
  });
  for (const prefix of ["/v1", "/api/v1", "/_hvm_api/v1"])
    server.use(prefix, inventoryRouter);
  return server;
}
const auth = (test: request.Test) =>
  test
    .set("Sec-Fetch-Site", "same-origin")
    .set(
      "Cookie",
      "hvm_access=local; hvm_reauth=local; hvm_portal_role=producer",
    );
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(verifyRecentAuthProof).mockReturnValue(true);
});
describe("T15 fronteira HTTP e identidade", () => {
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "montagem e leitura em %s",
    async (prefix) => {
      const spy = vi
        .spyOn(InventoryService, "getOwnerInventory")
        .mockResolvedValue({} as any);
      expect(
        (await request(app()).get(`${prefix}/producer/products/${id}/lots`))
          .status,
      ).toBe(200);
      expect(spy).toHaveBeenCalledWith(id, personId, userId, {
        lotsPage: 1,
        movementsPage: 1,
      });
      expect(
        (await request(app(null)).get(`${prefix}/producer/products/${id}/lots`))
          .status,
      ).toBe(401);
    },
  );
  it.each([null, "consumer", "platform_super_admin"])(
    "recusa mutação de %s",
    async (role) => {
      const spy = vi.spyOn(InventoryService, "registerHarvest");
      expect(
        (
          await auth(
            request(app(role)).post(`/v1/producer/products/${id}/lots`),
          ).send(input())
        ).status,
      ).toBe(role ? 403 : 401);
      expect(spy).not.toHaveBeenCalled();
    },
  );
  it("exige pessoa e portal de produtor", async () => {
    expect(
      (
        await request(app("producer", false)).get(
          `/v1/producer/products/${id}/lots`,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app())
          .get(`/v1/producer/products/${id}/lots`)
          .set("Cookie", "hvm_portal_role=consumer")
      ).status,
    ).toBe(403);
  });
  it("usa ator do servidor e registra contexto de auditoria", async () => {
    const save = vi
        .spyOn(InventoryService, "registerHarvest")
        .mockResolvedValue({} as any),
      value = input();
    expect(
      (
        await auth(
          request(app()).post(`/v1/producer/products/${id}/lots`),
        ).send(value)
      ).status,
    ).toBe(200);
    expect(save).toHaveBeenCalledWith(id, personId, value, userId, {
      requestId: expect.any(String),
      ipHash: "b".repeat(64),
    });
  });
  it("não aceita proprietário, data inválida ou quantidade fracionária", async () => {
    const save = vi.spyOn(InventoryService, "registerHarvest");
    for (const extra of [
      { personId },
      { quantity: 1.2 },
      { expirationDate: "2026-10-04" },
    ])
      expect(
        (
          await auth(
            request(app()).post(`/v1/producer/products/${id}/lots`),
          ).send({ ...input(), ...extra })
        ).status,
      ).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
  it("bloqueia CSRF e sessão sem autenticação recente", async () => {
    const save = vi.spyOn(InventoryService, "registerHarvest");
    expect(
      (
        await request(app())
          .post(`/v1/producer/products/${id}/lots`)
          .set("Sec-Fetch-Site", "cross-site")
          .send(input())
      ).status,
    ).toBe(403);
    vi.mocked(verifyRecentAuthProof).mockReturnValue(false);
    expect(
      (
        await auth(
          request(app()).post(`/v1/producer/products/${id}/lots`),
        ).send(input())
      ).body.error,
    ).toBe("RECENT_AUTH_REQUIRED");
    expect(save).not.toHaveBeenCalled();
  });
  it("metadados Vercel na query/URL são consumidos sem aceitar filtro privado ou duplicação", async () => {
    const spy = vi
      .spyOn(InventoryService, "getOwnerInventory")
      .mockResolvedValue({} as any);
    expect(
      (
        await request(app("producer", true, true)).get(
          `/v1/producer/products/${id}/lots?lotsPage=2&path=v1%2Fproducer&__hvm_path=route`,
        )
      ).status,
    ).toBe(200);
    expect(spy).toHaveBeenCalledWith(id, personId, userId, {
      lotsPage: 2,
      movementsPage: 1,
    });
    for (const query of [
      "lotsPage=1&lotsPage=2",
      "userId=private",
      "lotsPage=0",
    ])
      expect(
        (await request(app()).get(`/v1/producer/products/${id}/lots?${query}`))
          .status,
      ).toBe(400);
  });
  it.each([
    ["INVENTORY_LOT_CODE_CONFLICT", 409],
    ["INVENTORY_PRODUCT_NOT_FOUND", 404],
    ["INVENTORY_STORE_INELIGIBLE", 403],
  ])("erro %s preserva status %i e request ID", async (code, status) => {
    vi.spyOn(InventoryService, "registerHarvest").mockRejectedValue(
      new InventoryError(code as string, status as number),
    );
    const result = await auth(
      request(app()).post(`/v1/producer/products/${id}/lots`),
    ).send(input());
    expect(result.status).toBe(status);
    expect(result.body).toMatchObject({
      error: code,
      requestId: expect.any(String),
    });
  });
  it("dependência indisponível não vaza detalhe SQL", async () => {
    vi.spyOn(InventoryService, "getOwnerInventory").mockRejectedValue(
      new Error("private SQL"),
    );
    const result = await request(app()).get(`/v1/producer/products/${id}/lots`);
    expect(result.status).toBe(503);
    expect(result.body.error).toBe("DEPENDENCY_UNAVAILABLE");
  });
});
