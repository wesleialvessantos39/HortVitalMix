import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../server/security/recentAuth.ts", () => ({
  verifyRecentAuthProof: vi.fn(() => true),
}));
import { deliveryRouter } from "../../server/routes/deliveryRoutes.ts";
import {
  DeliveryQuoteService,
  DeliveryError,
} from "../../server/services/DeliveryQuoteService.ts";
import { verifyRecentAuthProof } from "../../server/security/recentAuth.ts";
import { deliveryCommand } from "../helpers/deliveryFixtures.ts";
const userId = randomUUID(),
  personId = randomUUID();
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
          path: ["v1", "producer", "store"],
          __hvm_path: "metadata",
          evil: "must-not-be-read",
        },
      });
    next();
  });
  for (const prefix of ["/v1", "/api/v1", "/_hvm_api/v1"])
    server.use(prefix, deliveryRouter);
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
describe("T16 fronteira HTTP", () => {
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "leitura privada em %s",
    async (prefix) => {
      const spy = vi
        .spyOn(DeliveryQuoteService, "getOwnerSettings")
        .mockResolvedValue({} as any);
      expect(
        (await request(app()).get(prefix + "/producer/store/delivery")).status,
      ).toBe(200);
      expect(spy).toHaveBeenCalledWith(personId, userId);
      expect(
        (await request(app(null)).get(prefix + "/producer/store/delivery"))
          .status,
      ).toBe(401);
    },
  );
  it.each([null, "consumer", "platform_super_admin"])(
    "recusa mutação de %s",
    async (role) => {
      const spy = vi.spyOn(DeliveryQuoteService, "saveOwnerSettings");
      expect(
        (
          await auth(
            request(app(role)).put("/v1/producer/store/delivery"),
          ).send(deliveryCommand())
        ).status,
      ).toBe(role ? 403 : 401);
      expect(spy).not.toHaveBeenCalled();
    },
  );
  it("exige pessoa e portal produtor", async () => {
    expect(
      (await request(app("producer", false)).get("/v1/producer/store/delivery"))
        .status,
    ).toBe(403);
    expect(
      (
        await request(app())
          .get("/v1/producer/store/delivery")
          .set("Cookie", "hvm_portal_role=consumer")
      ).status,
    ).toBe(403);
  });
  it("muta com identidade e auditoria do servidor", async () => {
    const spy = vi
        .spyOn(DeliveryQuoteService, "saveOwnerSettings")
        .mockResolvedValue({} as any),
      body = deliveryCommand();
    expect(
      (await auth(request(app()).put("/v1/producer/store/delivery")).send(body))
        .status,
    ).toBe(200);
    expect(spy).toHaveBeenCalledWith(personId, userId, body, {
      requestId: expect.any(String),
      ipHash: "b".repeat(64),
    });
  });
  it("reauth ausente ou vencida bloqueia antes do domínio", async () => {
    const spy = vi.spyOn(DeliveryQuoteService, "saveOwnerSettings");
    vi.mocked(verifyRecentAuthProof).mockReturnValue(false);
    const r = await auth(
      request(app()).put("/v1/producer/store/delivery"),
    ).send(deliveryCommand());
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("RECENT_AUTH_REQUIRED");
    expect(spy).not.toHaveBeenCalled();
  });
  it("CSRF recusa origem externa", async () => {
    const spy = vi.spyOn(DeliveryQuoteService, "saveOwnerSettings");
    expect(
      (
        await request(app())
          .put("/v1/producer/store/delivery")
          .set("Sec-Fetch-Site", "cross-site")
          .send(deliveryCommand())
      ).status,
    ).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
  it.each(["centerLatitude", "centerLongitude", "personId", "storeId"])(
    "ignora tentativa de forjar %s",
    async (field) => {
      const spy = vi.spyOn(DeliveryQuoteService, "saveOwnerSettings");
      expect(
        (
          await auth(request(app()).put("/v1/producer/store/delivery")).send({
            ...deliveryCommand(),
            [field]: randomUUID(),
          })
        ).status,
      ).toBe(400);
      expect(spy).not.toHaveBeenCalled();
    },
  );
  it("query Vercel é extraída da URL normalizada", async () => {
    const spy = vi
      .spyOn(DeliveryQuoteService, "getOwnerSettings")
      .mockResolvedValue({} as any);
    expect(
      (
        await request(app("producer", true, true)).get(
          "/v1/producer/store/delivery?path=v1&__hvm_path=internal",
        )
      ).status,
    ).toBe(200);
    expect(spy).toHaveBeenCalledOnce();
    expect(
      (await request(app()).get("/v1/producer/store/delivery?evil=1")).status,
    ).toBe(400);
    expect(
      (await request(app()).get("/v1/producer/store/delivery?evil=1&evil=2"))
        .status,
    ).toBe(400);
  });
  it("conflitos e indisponibilidade mantêm erros tipados sem SQL", async () => {
    const spy = vi.spyOn(DeliveryQuoteService, "saveOwnerSettings");
    spy.mockRejectedValue(new DeliveryError("DELIVERY_REVISION_CONFLICT", 409));
    const r = await auth(
      request(app()).put("/v1/producer/store/delivery"),
    ).send(deliveryCommand());
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("DELIVERY_REVISION_CONFLICT");
    spy.mockRejectedValue(new Error("secret SQL details"));
    const r2 = await auth(
      request(app()).put("/v1/producer/store/delivery"),
    ).send(deliveryCommand());
    expect(r2.status).toBe(503);
    expect(r2.body.error).toBe("DEPENDENCY_UNAVAILABLE");
  });
});
