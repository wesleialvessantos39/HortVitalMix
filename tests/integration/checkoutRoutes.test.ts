import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkoutRouter } from "../../server/routes/checkoutRoutes.ts";
import {
  CheckoutError,
  CheckoutService,
} from "../../server/services/CheckoutService.ts";
import { app as realApp } from "../../server/app.ts";
import vercelHandler from "../../server/vercelHandler.ts";
const userId = randomUUID();
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
    a.use(prefix, checkoutRouter);
  return a;
}
const origin = (r: request.Test) => r.set("Sec-Fetch-Site", "same-origin");
afterEach(() => vi.restoreAllMocks());
describe("T19: HTTP Auth, origem, header e contratos", () => {
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "sem Auth no prefixo %s retorna 401",
    async (p) => {
      expect((await request(realApp).get(p + "/checkout/context")).status).toBe(
        401,
      );
    },
  );
  it("contexto autenticado é emitido para o ator do servidor", async () => {
    const spy = vi.spyOn(CheckoutService, "getContext").mockResolvedValue({
      cartId: randomUUID(),
      serverTime: new Date().toISOString(),
      pendingConfirmation: null,
    });
    const r = await request(app("consumer")).get("/v1/checkout/context");
    expect(r.status).toBe(200);
    expect(spy.mock.calls[0][0]).toBe(userId);
    expect(String(r.headers["set-cookie"])).toContain("HttpOnly");
    expect(
      (
        await request(app("producer")).get(
          "/v1/checkout/context?userId=" + randomUUID(),
        )
      ).status,
    ).toBe(400);
  });
  it("administrador sem papel público é recusado", async () =>
    expect(
      (await request(app("platform_super_admin")).get("/v1/checkout/context"))
        .status,
    ).toBe(403));
  it("header ausente, inválido, duplicado ou UUID não v4 nunca chama o domínio", async () => {
    const spy = vi.spyOn(CheckoutService, "confirmCheckout");
    const body = { quoteId: randomUUID(), paymentMethod: "pix" };
    for (const id of [
      "",
      "bad",
      "00000000-0000-1000-8000-000000000000",
      randomUUID() + "," + randomUUID(),
    ])
      expect(
        (
          await origin(request(app("consumer")).post("/v1/checkout/confirm"))
            .set("X-Command-Id", id)
            .send(body)
        ).status,
      ).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
  it("identidade e total injetados no body são rejeitados", async () => {
    const spy = vi.spyOn(CheckoutService, "confirmCheckout");
    expect(
      (
        await origin(request(app("consumer")).post("/v1/checkout/confirm"))
          .set("X-Command-Id", randomUUID())
          .send({ quoteId: randomUUID(), paymentMethod: "pix", totalCents: 1 })
      ).status,
    ).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
  it("replay preserva código e body exatos, sem adicionar requestId à resposta gravada", async () => {
    const id = randomUUID(),
      body = { quoteId: randomUUID(), paymentMethod: "pix" as const },
      receipt = { statusCode: 201, body: { immutable: "exact" } as any };
    const spy = vi
      .spyOn(CheckoutService, "confirmCheckout")
      .mockResolvedValue(receipt);
    const r = await origin(
      request(app("consumer")).post("/v1/checkout/confirm"),
    )
      .set("X-Command-Id", id.toUpperCase())
      .send(body);
    expect(r.status).toBe(201);
    expect(r.body).toEqual(receipt.body);
    expect(spy).toHaveBeenCalledWith(id, body, userId, expect.any(Object));
  });
  it.each([
    [409, "COMMAND_ID_REUSED_DIFFERENT_PAYLOAD"],
    [410, "CHECKOUT_QUOTE_EXPIRED"],
  ])("erro de domínio %s é explícito", async (status, code) => {
    vi.spyOn(CheckoutService, "confirmCheckout").mockRejectedValue(
      new CheckoutError(String(code), Number(status)),
    );
    const r = await origin(
      request(app("consumer")).post("/v1/checkout/confirm"),
    )
      .set("X-Command-Id", randomUUID())
      .send({ quoteId: randomUUID(), paymentMethod: "pix" });
    expect(r.status).toBe(status);
    expect(r.body.error).toBe(code);
    expect(r.body.requestId).toBeTruthy();
  });
  it("origem cruzada é recusada antes da confirmação", async () => {
    const spy = vi.spyOn(CheckoutService, "confirmCheckout");
    const r = await request(app("consumer"))
      .post("/v1/checkout/confirm")
      .set("Origin", "https://attacker.invalid")
      .set("Sec-Fetch-Site", "cross-site")
      .set("X-Command-Id", randomUUID())
      .send({ quoteId: randomUUID(), paymentMethod: "pix" });
    expect(r.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
  it("dispatcher reconhece checkout e nunca confunde ausência de Auth com HTML", async () => {
    const r = await request(vercelHandler).get(
      "/api?__hvm_path=v1/checkout/context&path=v1%2Fcheckout%2Fcontext",
    );
    expect(r.status).toBe(401);
    expect(r.headers["content-type"]).toContain("application/json");
  });
});
