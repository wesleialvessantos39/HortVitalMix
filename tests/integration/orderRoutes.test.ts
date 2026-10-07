import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { orderRouter } from "../../server/routes/orderRoutes.ts";
import { OrderService } from "../../server/services/OrderService.ts";
import { CommerceError } from "../../server/services/CommerceSupport.ts";
import { app as realApp } from "../../server/app.ts";
import vercelHandler from "../../server/vercelHandler.ts";
const userId = randomUUID();
function app(role?: string) {
  const value = express();
  value.use(express.json());
  value.use((req, _res, next) => {
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
    value.use(prefix, orderRouter);
  return value;
}
const post = (a: express.Express, id = randomUUID()) =>
  request(a)
    .post("/v1/producer/orders/" + id + "/transitions")
    .set("Sec-Fetch-Site", "same-origin")
    .set("X-Command-Id", randomUUID());
afterEach(() => vi.restoreAllMocks());
describe("T21: HTTP, isolamento e dispatcher Vercel", () => {
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "todas as rotas exigem identidade em %s",
    async (prefix) => {
      for (const path of [
        "/orders",
        "/orders/" + randomUUID(),
        "/producer/orders",
      ])
        expect((await request(realApp).get(prefix + path)).status).toBe(401);
      expect(
        (
          await request(realApp)
            .post(prefix + "/producer/orders/" + randomUUID() + "/transitions")
            .set("Sec-Fetch-Site", "same-origin")
            .send({})
        ).status,
      ).toBe(401);
    },
  );
  it("produtor é inferido da sessão, sem aceitar impersonação na consulta", async () => {
    const spy = vi.spyOn(OrderService, "list").mockResolvedValue({} as any);
    expect(
      (
        await request(app("producer")).get(
          "/v1/producer/orders?page=2&status=confirmed",
        )
      ).status,
    ).toBe(200);
    expect(spy).toHaveBeenCalledWith(userId, "producer", {
      page: 2,
      status: "confirmed",
    });
    expect(
      (
        await request(app("producer")).get(
          "/v1/producer/orders?userId=" + randomUUID(),
        )
      ).status,
    ).toBe(422);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("consumidor e administrador não ganham permissão de avanço", async () => {
    const spy = vi.spyOn(OrderService, "transitionStatus");
    expect(
      (
        await post(app("consumer")).send({
          toStatus: "delivered",
          expectedRevision: 1,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await post(app("platform_super_admin")).send({
          toStatus: "delivered",
          expectedRevision: 1,
        })
      ).status,
    ).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });
  it("origem cruzada não alcança a mutação", async () => {
    const spy = vi.spyOn(OrderService, "transitionStatus");
    expect(
      (
        await post(app("producer"))
          .set("Origin", "https://attacker.invalid")
          .set("Sec-Fetch-Site", "cross-site")
          .send({ toStatus: "in_preparation", expectedRevision: 1 })
      ).status,
    ).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
  it("cancelamento sem motivo, identidade forjada e commandId ausente falham antes do domínio", async () => {
    const spy = vi.spyOn(OrderService, "transitionStatus");
    for (const body of [
      { toStatus: "cancelled", expectedRevision: 1 },
      {
        toStatus: "in_preparation",
        expectedRevision: 1,
        actorRole: "platform_super_admin",
      },
    ])
      expect((await post(app("producer")).send(body)).status).toBe(422);
    expect(
      (
        await request(app("producer"))
          .post("/v1/producer/orders/" + randomUUID() + "/transitions")
          .set("Sec-Fetch-Site", "same-origin")
          .send({ toStatus: "in_preparation", expectedRevision: 1 })
      ).status,
    ).toBe(422);
    expect(spy).not.toHaveBeenCalled();
  });
  it("transição recebe autor, papel e commandId reais fora do body", async () => {
    const spy = vi
        .spyOn(OrderService, "transitionStatus")
        .mockResolvedValue({ status: "in_preparation" } as any),
      orderId = randomUUID(),
      commandId = randomUUID();
    const result = await post(app("producer"), orderId)
      .set("X-Command-Id", commandId)
      .send({ toStatus: "in_preparation", expectedRevision: 1 });
    expect(result.status).toBe(200);
    expect(result.headers["cache-control"]).toContain("no-store");
    expect(spy).toHaveBeenCalledWith(
      orderId,
      userId,
      "producer",
      { toStatus: "in_preparation", expectedRevision: 1 },
      commandId,
      expect.objectContaining({ requestId: expect.any(String) }),
    );
  });
  it.each([
    ["ILLEGAL_TRANSITION", 422],
    ["REVISION_CONFLICT", 409],
    ["ORDER_NOT_FOUND", 404],
  ])("erro %s conserva o HTTP e não expõe pedido", async (code, status) => {
    vi.spyOn(OrderService, "get").mockRejectedValue(
      new CommerceError(String(code), Number(status)),
    );
    const result = await request(app("consumer")).get(
      "/v1/orders/" + randomUUID(),
    );
    expect(result.status).toBe(status);
    expect(result.body).toEqual({ error: code, requestId: expect.any(String) });
  });
  it("dispatcher de produção responde JSON para as novas rotas", async () => {
    const a = express();
    a.use((req, res) => void vercelHandler(req as any, res as any));
    for (const path of [
      "v1/orders",
      "v1/producer/orders",
      "v1/orders/" + randomUUID(),
    ]) {
      const r = await request(a).get(
        "/api?__hvm_path=" + encodeURIComponent(path),
      );
      expect(r.status).toBe(401);
      expect(r.headers["content-type"]).toContain("application/json");
    }
  });
});
