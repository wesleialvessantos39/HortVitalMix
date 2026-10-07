import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it, expect, vi } from "vitest";
import { notificationRouter } from "../../server/routes/notificationRoutes.ts";
import { producerSalesRouter } from "../../server/routes/producerSalesRoutes.ts";
import { cartRouter } from "../../server/routes/cartRoutes.ts";
import { checkoutRouter } from "../../server/routes/checkoutRoutes.ts";
import { commerceRouter } from "../../server/routes/commerceRoutes.ts";
import { orderRouter } from "../../server/routes/orderRoutes.ts";
import { reviewRouter } from "../../server/routes/reviewRoutes.ts";
import { NotificationService } from "../../server/services/NotificationService.ts";
import { ProducerSalesService } from "../../server/services/ProducerSalesService.ts";
const uid = randomUUID();
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
  for (const pre of ["/v1", "/api/v1", "/_hvm_api/v1"])
    for (const router of [
      notificationRouter,
      producerSalesRouter,
      cartRouter,
      checkoutRouter,
      commerceRouter,
      orderRouter,
      reviewRouter,
    ])
      a.use(pre, router);
  return a;
}
afterEach(() => vi.restoreAllMocks());
describe("Separação HTTP dos papéis e central de notificações", () => {
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "notificações exigem sessão e respeitam papel no prefixo %s",
    async (pre) => {
      const spy = vi
        .spyOn(NotificationService, "list")
        .mockResolvedValue({} as any);
      expect((await request(app()).get(pre + "/notifications")).status).toBe(
        401,
      );
      const r = await request(app(["producer", "consumer"]))
        .get(pre + "/notifications?page=2&path=ignored&__hvm_path=ignored")
        .set("Cookie", "hvm_portal_role=producer");
      expect(r.status).toBe(200);
      expect(r.headers["cache-control"]).toContain("private");
      expect(spy).toHaveBeenCalledWith(
        { userId: uid, role: "producer" },
        { page: "2" },
      );
    },
  );
  it.each([
    "/cart",
    "/checkout/context",
    "/commerce/purchases",
    "/commerce/refunds",
    "/orders",
    "/orders/" + randomUUID() + "/review",
  ])(
    "produtor, inclusive com consumer cadastrado, não compra pelo portal producer: %s",
    async (path) => {
      const r = await request(app(["producer", "consumer"]))
        .get("/v1" + path)
        .set("Cookie", "hvm_portal_role=producer");
      expect(r.status).toBe(403);
    },
  );
  it("produtor não publica avaliação nem confirma recebimento pelo portal producer", async () => {
    for (const path of [
      "/reviews",
      "/commerce/orders/" + randomUUID() + "/received",
    ])
      expect(
        (
          await request(app(["producer", "consumer"]))
            .post("/v1" + path)
            .set("Cookie", "hvm_portal_role=producer")
            .set("Sec-Fetch-Site", "same-origin")
            .send({})
        ).status,
      ).toBe(403);
  });
  it("cookie não concede papel ausente e identidade não pode ser escolhida em query", async () => {
    expect(
      (
        await request(app(["producer"]))
          .get("/v1/notifications")
          .set("Cookie", "hvm_portal_role=consumer")
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app(["consumer"])).get(
          "/v1/notifications?userId=" + randomUUID(),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app(["producer"])).get(
          "/v1/producer/sales?storeId=" + randomUUID(),
        )
      ).status,
    ).toBe(422);
  });
  it("Minhas vendas passa pelo acesso de produtor e não permite consumidor", async () => {
    const spy = vi
      .spyOn(ProducerSalesService, "sales")
      .mockResolvedValue({} as any);
    expect(
      (await request(app(["consumer"])).get("/v1/producer/sales")).status,
    ).toBe(403);
    expect(
      (
        await request(app(["producer"])).get(
          "/v1/producer/sales?source=pos&path=ignored",
        )
      ).status,
    ).toBe(200);
    expect(spy).toHaveBeenCalledWith(uid, { source: "pos" });
  });
  it("origem cruzada não marca avisos nem envia contato ao vendedor", async () => {
    const spy = vi.spyOn(NotificationService, "read");
    for (const path of [
      "/notifications/" + randomUUID() + "/read",
      "/notifications/read-all",
    ])
      expect(
        (
          await request(app(["consumer"]))
            .post("/v1" + path)
            .set("Origin", "https://attacker.invalid")
            .set("Sec-Fetch-Site", "cross-site")
            .send({})
        ).status,
      ).toBe(403);
    expect(spy).not.toHaveBeenCalled();
    expect(
      (
        await request(app(["producer"]))
          .post("/v1/producer/refunds/" + randomUUID() + "/seller-contacts")
          .send({ message: "Tentativa do vendedor" })
      ).status,
    ).toBe(404);
  });
});
