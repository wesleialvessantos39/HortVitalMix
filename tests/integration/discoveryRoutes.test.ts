import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoveryRouter } from "../../server/routes/discoveryRoutes.ts";
import {
  DiscoveryService,
  DiscoveryError,
} from "../../server/services/DiscoveryService.ts";
const userId = randomUUID(),
  personId = randomUUID(),
  targetId = randomUUID();
function app(signedIn = true, hasPerson = true, vercel = false) {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    req.actor = signedIn
      ? {
          userId,
          personId: hasPerson ? personId : null,
          email: null,
          fullName: null,
          roles: ["consumer"],
        }
      : null;
    req.requestId = randomUUID();
    req.clientIpHash = "e".repeat(64);
    if (vercel)
      Object.defineProperty(req, "query", {
        configurable: true,
        value: { path: "internal", evil: "ignored-transport" },
      });
    next();
  });
  for (const prefix of ["/v1", "/api/v1", "/_hvm_api/v1"])
    server.use(prefix, discoveryRouter);
  return server;
}
afterEach(() => vi.restoreAllMocks());
describe("T17 autenticação, origem e transporte HTTP", () => {
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "busca pública em %s",
    async (prefix) => {
      const spy = vi
        .spyOn(DiscoveryService, "searchStores")
        .mockResolvedValue({
          stores: [],
          page: 1,
          pageSize: 20,
          hasMore: false,
          distanceReference: "ariquemes",
        });
      expect(
        (await request(app(false)).get(prefix + "/discovery/stores")).status,
      ).toBe(200);
      expect(spy).toHaveBeenCalledWith({ page: 1 });
    },
  );
  it("normaliza a URL Vercel e preserva latitude 0", async () => {
    const spy = vi
      .spyOn(DiscoveryService, "searchStores")
      .mockResolvedValue({
        stores: [],
        page: 2,
        pageSize: 20,
        hasMore: false,
        distanceReference: "consumer",
      });
    const result = await request(app(false, true, true)).get(
      "/api/v1/discovery/stores?path=v1%2Fdiscovery%2Fstores&__hvm_path=v1%2Fdiscovery%2Fstores&query=couve&latitude=0&longitude=0&page=2",
    );
    expect(result.status).toBe(200);
    expect(spy).toHaveBeenCalledWith({
      query: "couve",
      latitude: 0,
      longitude: 0,
      page: 2,
    });
  });
  it.each([
    "latitude=",
    "latitude=1",
    "latitude=NaN&longitude=0",
    "latitude=Infinity&longitude=0",
    "page=1&page=2",
    "query=a&query=b",
    "unknown=1",
    "page=1e2",
    "latitude[]=1&longitude=0",
  ])("rejeita query inválida %s", async (query) => {
    const spy = vi.spyOn(DiscoveryService, "searchStores");
    expect(
      (await request(app()).get("/v1/discovery/stores?" + query)).status,
    ).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
  it("favoritos exigem pessoa/sessão e nunca confiam na identidade do payload", async () => {
    expect((await request(app(false)).get("/v1/favorites")).status).toBe(401);
    expect((await request(app(true, false)).get("/v1/favorites")).status).toBe(
      403,
    );
    const body = { targetType: "store", targetId, commandId: randomUUID() };
    const spy = vi
      .spyOn(DiscoveryService, "toggleFavorite")
      .mockResolvedValue({
        targetType: "store",
        targetId,
        isFavorite: true,
        replayed: false,
      });
    expect(
      (
        await request(app())
          .post("/v1/favorites/toggle")
          .set("Sec-Fetch-Site", "same-origin")
          .send({ ...body, personId: randomUUID() })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app())
          .post("/v1/favorites/toggle")
          .set("Sec-Fetch-Site", "same-origin")
          .send(body)
      ).status,
    ).toBe(200);
    expect(spy).toHaveBeenCalledWith(
      personId,
      userId,
      body,
      expect.objectContaining({ ipHash: "e".repeat(64) }),
    );
  });
  it("bloqueia mutation cross-site antes de chamar o domínio", async () => {
    const spy = vi.spyOn(DiscoveryService, "toggleFavorite");
    expect(
      (
        await request(app())
          .post("/v1/favorites/toggle")
          .set("Sec-Fetch-Site", "cross-site")
          .send({ targetType: "store", targetId, commandId: randomUUID() })
      ).status,
    ).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
  it("lista apenas o titular com IDs de alvo validados", async () => {
    const spy = vi
      .spyOn(DiscoveryService, "listFavorites")
      .mockResolvedValue({ favorites: [], page: 1, hasMore: false });
    expect(
      (
        await request(app()).get(
          "/v1/favorites?targetType=store&targetIds=" + targetId,
        )
      ).status,
    ).toBe(200);
    expect(spy).toHaveBeenCalledWith(personId, userId, {
      targetType: "store",
      targetIds: [targetId],
      page: 1,
    });
    expect(
      (await request(app()).get("/v1/favorites?personId=" + randomUUID()))
        .status,
    ).toBe(400);
  });
  it("retorna erros de domínio sem SQL ou detalhes privados", async () => {
    vi.spyOn(DiscoveryService, "searchStores").mockRejectedValue(
      new DiscoveryError("DEPENDENCY_UNAVAILABLE", 503),
    );
    const result = await request(app()).get("/v1/discovery/stores");
    expect(result.status).toBe(503);
    expect(result.body).toEqual({
      error: "DEPENDENCY_UNAVAILABLE",
      requestId: expect.any(String),
    });
  });
});
