import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cartRouter } from "../../server/routes/cartRoutes.ts";
import { CartError, CartService } from "../../server/services/CartService.ts";
import { app as realApp } from "../../server/app.ts";
import vercelHandler from "../../server/vercelHandler.ts";
const userId = randomUUID(),
  empty = { stores: [], itemCount: 0, subtotalCents: 0 };
function app(role?: string) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.actor = role
      ? {
          userId,
          personId: randomUUID(),
          email: null,
          fullName: null,
          roles: [role],
        }
      : null;
    req.requestId = randomUUID();
    req.clientIpHash = "a".repeat(64);
    next();
  });
  for (const prefix of ["/v1", "/api/v1", "/_hvm_api/v1"])
    a.use(prefix, cartRouter);
  return a;
}
const sameOrigin = (r: request.Test) => r.set("Sec-Fetch-Site", "same-origin");
afterEach(() => vi.restoreAllMocks());
describe("T18 fronteira HTTP: somente sessão do servidor", () => {
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "cesta montada no prefixo %s",
    async (prefix) => {
      vi.spyOn(CartService, "getCartGroupedByStore").mockResolvedValue(empty);
      const response = await request(realApp).get(prefix + "/cart");
      expect(response.status).toBe(200);
      expect(response.body).toEqual(empty);
      expect(String(response.headers["set-cookie"])).toMatch(
        /hvm_cart=.*HttpOnly/,
      );
      expect(String(response.headers["set-cookie"])).toContain(
        "SameSite=Lax",
      );
    },
  );
  it("dispatcher aceita metadados Vercel e recusa identidade em query", async () => {
    vi.spyOn(CartService, "getCartGroupedByStore").mockResolvedValue(empty);
    expect(
      (
        await request(vercelHandler).get(
          "/api?__hvm_path=v1/cart&path=v1%2Fcart",
        )
      ).status,
    ).toBe(200);
    expect(
      (await request(app()).get("/v1/cart?sessionId=" + randomUUID())).status,
    ).toBe(400);
  });
  it("cookie válido é preservado; corpo não define identidade ou preço", async () => {
    const sessionId = randomUUID(),
      id = randomUUID(),
      spy = vi.spyOn(CartService, "addItem").mockResolvedValue(empty);
    const response = await sameOrigin(
      request(app("consumer")).post("/v1/cart/items"),
    )
      .set("Cookie", "hvm_cart=" + sessionId)
      .send({ productId: id, quantity: 1 });
    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(
      { sessionId, userId },
      { productId: id, quantity: 1 },
      expect.any(Object),
    );
    expect(
      (
        await sameOrigin(request(app()).post("/v1/cart/items")).send({
          productId: id,
          quantity: 1,
          userId,
        })
      ).status,
    ).toBe(400);
  });
  it("quantidade 100 e corte inválido não alcançam o serviço", async () => {
    const spy = vi.spyOn(CartService, "addItem").mockResolvedValue(empty);
    for (const body of [
      { productId: randomUUID(), quantity: 100 },
      { productId: randomUUID(), quantity: 1, cutType: "desconhecido" },
    ])
      expect(
        (await sameOrigin(request(app()).post("/v1/cart/items")).send(body))
          .status,
      ).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
  it("requisição de outra origem é recusada antes de mutação", async () => {
    const spy = vi.spyOn(CartService, "addItem").mockResolvedValue(empty);
    const response = await request(app())
      .post("/v1/cart/items")
      .set("Origin", "https://attacker.invalid")
      .set("Sec-Fetch-Site", "cross-site")
      .send({ productId: randomUUID(), quantity: 1 });
    expect(response.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
  it("cookie de cesta salva de outro titular é rotacionado sem vazar itens", async () => {
    const old = randomUUID(),
      spy = vi
        .spyOn(CartService, "getCartGroupedByStore")
        .mockRejectedValueOnce(new CartError("CART_SESSION_OWNED", 409))
        .mockResolvedValue(empty);
    const response = await request(app())
      .get("/v1/cart")
      .set("Cookie", "hvm_cart=" + old);
    expect(response.body).toEqual(empty);
    const next = spy.mock.calls[1][0].sessionId;
    expect(next).not.toBe(old);
    expect(String(response.headers["set-cookie"])).toContain(next);
  });
  it("sessão expirada não se torna visitante silenciosamente; administradores não usam cesta pública", async () => {
    const spy = vi
      .spyOn(CartService, "getCartGroupedByStore")
      .mockResolvedValue(empty);
    expect(
      (await request(app()).get("/v1/cart").set("Cookie", "hvm_access=invalid"))
        .status,
    ).toBe(401);
    expect(
      (await request(app("platform_super_admin")).get("/v1/cart")).status,
    ).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
  it("erros de publicação chegam como 404 explícito", async () => {
    vi.spyOn(CartService, "addItem").mockRejectedValue(
      new CartError("CART_PRODUCT_UNAVAILABLE", 404),
    );
    const response = await sameOrigin(
      request(app()).post("/v1/cart/items"),
    ).send({ productId: randomUUID(), quantity: 1 });
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("CART_PRODUCT_UNAVAILABLE");
  });
  it("mix, atualização e remoção têm payload e ID estritos", async () => {
    const id = randomUUID(),
      key = randomUUID();
    vi.spyOn(CartService, "addHortiMix").mockResolvedValue(empty);
    vi.spyOn(CartService, "updateItem").mockResolvedValue(empty);
    vi.spyOn(CartService, "removeItem").mockResolvedValue(empty);
    expect(
      (
        await sameOrigin(request(app()).post("/v1/cart/mix")).send({
          items: [{ productId: id, quantity: 1, cutType: "cubos" }],
          commandId: key,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await sameOrigin(request(app()).patch(`/v1/cart/items/${id}`)).send({
          quantity: 2,
          commandId: key,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await sameOrigin(
          request(app()).post(`/v1/cart/items/${id}/remove`),
        ).send({ commandId: key })
      ).status,
    ).toBe(200);
    expect(
      (
        await sameOrigin(
          request(app()).patch("/v1/cart/items/not-a-uuid"),
        ).send({ quantity: 2, commandId: key })
      ).status,
    ).toBe(400);
  });
});
