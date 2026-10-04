import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../server/security/recentAuth.ts", () => ({
  verifyRecentAuthProof: vi.fn(() => true),
}));
import { producerStoreRouter } from "../../server/routes/producerStoreRoutes.ts";
import {
  ProducerStoreError,
  ProducerStoreService,
} from "../../server/services/ProducerStoreService.ts";
import { verifyRecentAuthProof } from "../../server/security/recentAuth.ts";
const userId = randomUUID(),
  storeId = randomUUID();
function app(role: string | null = "producer") {
  const server = express();
  server.use(express.json());
  server.use((req, res, next) => {
    req.actor = role
      ? {
          userId,
          email: "produtor@example.test",
          roles: [role],
          personId: randomUUID(),
          fullName: "Produtor",
        }
      : null;
    req.requestId = randomUUID();
    req.clientIpHash = "a".repeat(64);
    res.locals.requestId = req.requestId;
    next();
  });
  server.use("/v1", producerStoreRouter);
  return server;
}
function mutation(test: request.Test) {
  return test
    .set("Sec-Fetch-Site", "same-origin")
    .set(
      "Cookie",
      "hvm_access=fake; hvm_reauth=fake; hvm_portal_role=producer",
    );
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(verifyRecentAuthProof).mockReturnValue(true);
});
describe("T12 rotas de loja", () => {
  it("exige sessão e perfil produtor", async () => {
    expect((await request(app(null)).get("/v1/producer/store")).status).toBe(
      401,
    );
    expect(
      (await request(app("consumer")).get("/v1/producer/store")).status,
    ).toBe(403);
  });
  it("não aceita sessão de outro portal", async () =>
    expect(
      (
        await request(app())
          .get("/v1/producer/store")
          .set("Cookie", "hvm_portal_role=consumer")
      ).status,
    ).toBe(403));
  it("usa o usuário validado no servidor para ler o titular", async () => {
    const get = vi
      .spyOn(ProducerStoreService, "getStoreSettings")
      .mockResolvedValue({ store: null, properties: [], canPublish: false });
    expect((await request(app()).get("/v1/producer/store")).status).toBe(200);
    expect(get).toHaveBeenCalledWith(userId);
  });
  it("bloqueia CSRF antes de mutações", async () =>
    expect(
      (
        await request(app())
          .post("/v1/producer/store")
          .set("Sec-Fetch-Site", "cross-site")
          .send({ commandId: randomUUID() })
      ).status,
    ).toBe(403));
  it("exige reautenticação para publicação", async () => {
    vi.mocked(verifyRecentAuthProof).mockReturnValue(false);
    expect(
      (
        await mutation(
          request(app()).post(`/v1/producer/store/${storeId}/publish`),
        ).send({ commandId: randomUUID(), expectedRevision: 1 })
      ).body.error,
    ).toBe("RECENT_AUTH_REQUIRED");
  });
  it("permite pausar imediatamente sem prova recente, mantendo titularidade", async () => {
    vi.mocked(verifyRecentAuthProof).mockReturnValue(false);
    const pause = vi
      .spyOn(ProducerStoreService, "pauseStore")
      .mockResolvedValue({} as any);
    expect(
      (
        await mutation(
          request(app()).post(`/v1/producer/store/${storeId}/pause`),
        ).send({
          commandId: randomUUID(),
          expectedRevision: 1,
          reason: "Chuva forte",
        })
      ).status,
    ).toBe(200);
    expect(pause.mock.calls[0]?.slice(0, 2)).toEqual([storeId, userId]);
  });
  it("propaga a trava comercial como 403", async () => {
    vi.spyOn(ProducerStoreService, "publishStore").mockRejectedValue(
      new ProducerStoreError("STORE_PUBLISH_FORBIDDEN", 403),
    );
    const res = await mutation(
      request(app()).post(`/v1/producer/store/${storeId}/publish`),
    ).send({ commandId: randomUUID(), expectedRevision: 1 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("STORE_PUBLISH_FORBIDDEN");
  });
  it("retorna revisão corrente em conflito sem sobrescrever", async () => {
    vi.spyOn(ProducerStoreService, "publishStore").mockRejectedValue(
      new ProducerStoreError("STORE_REVISION_CONFLICT", 409, 3),
    );
    const res = await mutation(
      request(app()).post(`/v1/producer/store/${storeId}/publish`),
    ).send({ commandId: randomUUID(), expectedRevision: 1 });
    expect(res.status).toBe(409);
    expect(res.body.currentRevision).toBe(3);
  });
  it("valida IDs e campos extras antes do serviço", async () => {
    const publish = vi.spyOn(ProducerStoreService, "publishStore");
    expect(
      (
        await mutation(
          request(app()).post("/v1/producer/store/invalido/publish"),
        ).send({ commandId: randomUUID(), expectedRevision: 1 })
      ).status,
    ).toBe(400);
    expect(
      (
        await mutation(
          request(app()).post(`/v1/producer/store/${storeId}/publish`),
        ).send({
          commandId: randomUUID(),
          expectedRevision: 1,
          status: "active",
        })
      ).status,
    ).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });
  it("vitrine é acessível sem autenticação", async () => {
    vi.spyOn(ProducerStoreService, "getPublicStore").mockResolvedValue({
      name: "Chácara",
    } as any);
    const res = await request(app(null)).get("/v1/stores/chacara-local");
    expect(res.status).toBe(200);
  });
  it("loja oculta tem o mesmo 404 da loja inexistente", async () => {
    vi.spyOn(ProducerStoreService, "getPublicStore").mockRejectedValue(
      new ProducerStoreError("STORE_NOT_FOUND", 404),
    );
    const res = await request(app(null)).get("/v1/stores/chacara-local");
    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty("status");
  });
});
