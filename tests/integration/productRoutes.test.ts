import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../server/security/recentAuth.ts", () => ({
  verifyRecentAuthProof: vi.fn(() => true),
}));
import { productRouter } from "../../server/routes/productRoutes.ts";
import {
  ProductService,
  ProductError,
} from "../../server/services/ProductService.ts";
import { verifyRecentAuthProof } from "../../server/security/recentAuth.ts";
const userId = randomUUID(),
  personId = randomUUID(),
  id = randomUUID();
const create = () => ({
  categoryId: randomUUID(),
  title: "Couve picada",
  description: "Couve fresca e higienizada.",
  packagingType: "pote_higienizado",
  netWeightGrams: 250,
  unitType: "pote",
  priceCents: 1290,
  commandId: randomUUID(),
});
const command = () => ({ commandId: randomUUID(), expectedRevision: 1 });
function app(role: string | null = "producer") {
  const server = express();
  server.use(express.json());
  server.use((req, res, next) => {
    req.actor = role
      ? {
          userId,
          personId,
          email: "produtor@example.test",
          fullName: "Produtor",
          roles: [role],
        }
      : null;
    req.requestId = randomUUID();
    req.clientIpHash = "a".repeat(64);
    res.locals.requestId = req.requestId;
    next();
  });
  for (const prefix of ["/v1", "/api/v1", "/_hvm_api/v1"])
    server.use(prefix, productRouter);
  return server;
}
const authenticated = (test: request.Test) =>
  test
    .set("Sec-Fetch-Site", "same-origin")
    .set(
      "Cookie",
      "hvm_access=local; hvm_reauth=local; hvm_portal_role=producer",
    );
beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(verifyRecentAuthProof).mockReturnValue(true);
});
describe("T14 fronteira HTTP", () => {
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "leitura pública e leitura privada em %s",
    async (prefix) => {
      vi.spyOn(ProductService, "listPublicProducts").mockResolvedValue([]);
      expect((await request(app(null)).get(prefix + "/products")).body).toEqual(
        { products: [] },
      );
      expect(
        (await request(app(null)).get(prefix + "/producer/products")).status,
      ).toBe(401);
    },
  );
  it.each([null, "consumer", "platform_super_admin"])(
    "recusa mutação para %s",
    async (role) => {
      const save = vi.spyOn(ProductService, "createProduct");
      expect(
        (
          await authenticated(
            request(app(role)).post("/v1/producer/products"),
          ).send(create())
        ).status,
      ).toBe(role ? 403 : 401);
      expect(save).not.toHaveBeenCalled();
    },
  );
  it("verifica portal sem confiar no payload", async () => {
    expect(
      (
        await request(app())
          .get("/v1/producer/products")
          .set("Cookie", "hvm_portal_role=consumer")
      ).status,
    ).toBe(403);
    const save = vi.spyOn(ProductService, "createProduct");
    expect(
      (
        await authenticated(request(app()).post("/v1/producer/products")).send({
          ...create(),
          personId,
        })
      ).status,
    ).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
  it("injeta identidade e contexto validados pelo servidor", async () => {
    const save = vi
        .spyOn(ProductService, "createProduct")
        .mockResolvedValue({} as any),
      input = create();
    expect(
      (
        await authenticated(request(app()).post("/v1/producer/products")).send(
          input,
        )
      ).status,
    ).toBe(200);
    expect(save.mock.calls[0]).toEqual([
      personId,
      expect.objectContaining(input),
      userId,
      { requestId: expect.any(String), ipHash: "a".repeat(64) },
    ]);
  });
  it.each([0, -1])(
    "peso/preço inválidos não chegam ao serviço: %s",
    async (value) => {
      const save = vi.spyOn(ProductService, "createProduct");
      expect(
        (
          await authenticated(
            request(app()).post("/v1/producer/products"),
          ).send({ ...create(), priceCents: value, netWeightGrams: value })
        ).status,
      ).toBe(400);
      expect(save).not.toHaveBeenCalled();
    },
  );
  it("bloqueia cross-site", async () => {
    const save = vi.spyOn(ProductService, "createProduct");
    expect(
      (
        await request(app())
          .post("/v1/producer/products")
          .set("Sec-Fetch-Site", "cross-site")
          .send(create())
      ).status,
    ).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });
  it("reautenticação é obrigatória para preço e publicação, mas não atrasa despublicação", async () => {
    vi.mocked(verifyRecentAuthProof).mockReturnValue(false);
    const publish = vi
      .spyOn(ProductService, "togglePublish")
      .mockResolvedValue({} as any);
    expect(
      (
        await authenticated(
          request(app()).post(`/v1/producer/products/${id}/price`),
        ).send({ ...command(), newPriceCents: 1390 })
      ).body.error,
    ).toBe("RECENT_AUTH_REQUIRED");
    expect(
      (
        await authenticated(
          request(app()).post(`/v1/producer/products/${id}/publish`),
        ).send({ ...command(), isPublished: true })
      ).status,
    ).toBe(401);
    expect(
      (
        await authenticated(
          request(app()).post(`/v1/producer/products/${id}/publish`),
        ).send({ ...command(), isPublished: false })
      ).status,
    ).toBe(200);
    expect(publish).toHaveBeenCalledOnce();
  });
  it.each([
    ["PRODUCT_CREATE_FORBIDDEN_UNVERIFIED_STORE", 403],
    ["PRODUCT_PRIMARY_MEDIA_REQUIRED", 422],
    ["PRODUCT_NOT_FOUND", 404],
  ])("propaga %s com request ID", async (code, status) => {
    vi.spyOn(ProductService, "togglePublish").mockRejectedValue(
      new ProductError(String(code), Number(status)),
    );
    const response = await authenticated(
      request(app()).post(`/v1/producer/products/${id}/publish`),
    ).send({ ...command(), isPublished: true });
    expect(response.status).toBe(status);
    expect(response.body.requestId).toBeTruthy();
  });
  it("409 conserva revisão corrente", async () => {
    vi.spyOn(ProductService, "updatePrice").mockRejectedValue(
      new ProductError("PRODUCT_REVISION_CONFLICT", 409, 3),
    );
    const response = await authenticated(
      request(app()).post(`/v1/producer/products/${id}/price`),
    ).send({ ...command(), newPriceCents: 1390 });
    expect(response.status).toBe(409);
    expect(response.body.currentRevision).toBe(3);
  });
  it("recebe imagem binária sem elevar o limite JSON global", async () => {
    const upload = vi
        .spyOn(ProductService, "uploadMedia")
        .mockResolvedValue({} as any),
      cmd = command();
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const result = await authenticated(
      request(app()).post(
        `/v1/producer/products/${id}/media/upload?commandId=${cmd.commandId}&expectedRevision=1`,
      ),
    )
      .set("Content-Type", "image/png")
      .send(bytes);
    expect(result.status).toBe(200);
    expect(upload.mock.calls[0][4]).toEqual(bytes);
  });
  it("valida IDs/filtros e não oferece DELETE/produto público mutável", async () => {
    expect(
      (await request(app()).get("/v1/products?isPublished=false")).status,
    ).toBe(400);
    expect(
      (await request(app()).get("/v1/producer/products/invalido")).status,
    ).toBe(400);
    expect(
      (
        await authenticated(
          request(app()).delete(`/v1/producer/products/${id}`),
        )
      ).status,
    ).toBe(404);
    expect(
      (await authenticated(request(app()).post("/v1/products")).send(create()))
        .status,
    ).toBe(404);
  });
});
