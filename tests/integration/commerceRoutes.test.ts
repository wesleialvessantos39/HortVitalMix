import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  commerceRouter,
  adminCommerceRouter,
} from "../../server/routes/commerceRoutes.ts";
import { CommerceService } from "../../server/services/CommerceService.ts";
import { AfterSalesService } from "../../server/services/AfterSalesService.ts";
import { PaymentService } from "../../server/services/PaymentService.ts";
import { CommerceError } from "../../server/services/CommerceSupport.ts";
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
  for (const prefix of ["/v1", "/api/v1", "/_hvm_api/v1"]) {
    a.use(prefix, commerceRouter);
    a.use(prefix + "/admin", adminCommerceRouter);
    a.post(prefix + "/admin/auth/login", (_req, res) =>
      res.status(200).json({ reachedExistingLogin: true }),
    );
  }
  return a;
}
const origin = (r: request.Test) => r.set("Sec-Fetch-Site", "same-origin");
afterEach(() => vi.restoreAllMocks());
describe("T20: HTTP, origem, sessão e preparação financeira", () => {
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "protege todas as leituras privadas em %s",
    async (prefix) => {
      for (const path of [
        "/commerce/purchases",
        "/producer/pos",
        "/commerce/refunds",
        "/commerce/complaints",
        "/payments/" + randomUUID(),
        "/admin/commerce/settings",
      ])
        expect((await request(realApp).get(prefix + path)).status).toBe(401);
    },
  );
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "middleware novo não intercepta o login administrativo anterior em %s",
    async (prefix) => {
      const r = await origin(
        request(app()).post(prefix + "/admin/auth/login"),
      ).send({});
      expect(r.status).toBe(200);
      expect(r.body.reachedExistingLogin).toBe(true);
    },
  );
  it("consulta o domínio somente pela identidade da sessão", async () => {
    const spy = vi
      .spyOn(CommerceService, "purchases")
      .mockResolvedValue({ orders: [], pendingPayments: [] } as any);
    expect(
      (
        await request(app("consumer")).get(
          "/v1/commerce/purchases?userId=" + randomUUID(),
        )
      ).status,
    ).toBe(200);
    expect(spy).toHaveBeenCalledWith(userId);
    expect(
      (await request(app("platform_super_admin")).get("/v1/commerce/purchases"))
        .status,
    ).toBe(401);
  });
  it("origem cruzada bloqueia caixa, denúncias, reembolso e confirmação de recebimento", async () => {
    const pos = vi.spyOn(CommerceService, "createPosSale"),
      refund = vi.spyOn(AfterSalesService, "requestRefund"),
      complaint = vi.spyOn(AfterSalesService, "createComplaint"),
      received = vi.spyOn(CommerceService, "received");
    for (const path of [
      "/producer/pos/sales",
      "/commerce/refunds",
      "/commerce/complaints",
      "/commerce/orders/" + randomUUID() + "/received",
    ]) {
      expect(
        (
          await request(app("consumer"))
            .post("/v1" + path)
            .set("Origin", "https://attacker.invalid")
            .set("Sec-Fetch-Site", "cross-site")
            .send({})
        ).status,
      ).toBe(403);
    }
    for (const spy of [pos, refund, complaint, received])
      expect(spy).not.toHaveBeenCalled();
  });
  it("nunca aceita PAN, CVV ou preço ao preparar pagamento", async () => {
    const spy = vi.spyOn(PaymentService, "view");
    const r = await origin(
      request(app("consumer")).post("/v1/payments/" + randomUUID() + "/start"),
    ).send({ cardNumber: "0000000000000000", cvv: "000", totalCents: 1 });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("VALIDATION_ERROR");
    expect(spy).not.toHaveBeenCalled();
  });
  it("não inicia cobrança mesmo para uma intenção própria válida", async () => {
    vi.spyOn(PaymentService, "view").mockResolvedValue({} as any);
    const r = await origin(
      request(app("consumer")).post("/v1/payments/" + randomUUID() + "/start"),
    ).send({});
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("GATEWAY_NOT_CONFIGURED");
  });
  it("webhook forjado permanece indisponível sem gateway e responde JSON nos três prefixos", async () => {
    for (const prefix of ["/v1", "/api/v1", "/_hvm_api/v1"]) {
      const r = await request(realApp)
        .post(prefix + "/payments/webhook")
        .set("Origin", "https://attacker.invalid")
        .set("Sec-Fetch-Site", "cross-site")
        .send({ txid: randomUUID(), status: "approved" });
      expect(r.status).toBe(503);
      expect(r.body.error).toBe("GATEWAY_NOT_CONFIGURED");
      expect(r.headers["content-type"]).toContain("application/json");
    }
  });
  it("erro de autorização do domínio não vira sucesso nem expõe dados", async () => {
    vi.spyOn(PaymentService, "view").mockRejectedValue(
      new CommerceError("PAYMENT_NOT_FOUND", 404),
    );
    const r = await request(app("consumer")).get(
      "/v1/payments/" + randomUUID(),
    );
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("PAYMENT_NOT_FOUND");
    expect(r.body.requestId).toBeTruthy();
  });
  it("pagina e filtra sem aceitar SQL ou página negativa", async () => {
    const spy = vi
      .spyOn(AfterSalesService, "cases")
      .mockResolvedValue({ page: 2, pages: 3, total: 102, cases: [] });
    expect(
      (
        await request(app("consumer")).get(
          "/v1/commerce/complaints?page=2&filter=open",
        )
      ).status,
    ).toBe(200);
    expect(spy).toHaveBeenCalledWith(userId, "complaint", undefined, 2, "open");
    for (const q of ["page=-1", "page=1%3BDROP%20TABLE", "filter=untrusted"])
      expect(
        (await request(app("consumer")).get("/v1/commerce/complaints?" + q))
          .status,
      ).toBe(422);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("dispatcher Vercel preserva JSON e sessão exigida", async () => {
    const r = await request(vercelHandler).get(
      "/api?__hvm_path=v1/commerce/purchases&path=v1%2Fcommerce%2Fpurchases",
    );
    expect(r.status).toBe(401);
    expect(r.headers["content-type"]).toContain("application/json");
  });
});
