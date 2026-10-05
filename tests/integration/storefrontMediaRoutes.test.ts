import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../server/security/recentAuth.ts", () => ({
  verifyRecentAuthProof: vi.fn(() => true),
}));
import { verifyRecentAuthProof } from "../../server/security/recentAuth.ts";
import { producerStoreRouter } from "../../server/routes/producerStoreRoutes.ts";
import { discoveryRouter } from "../../server/routes/discoveryRoutes.ts";
import { StoreMediaService } from "../../server/services/StoreMediaService.ts";
import { ProductService } from "../../server/services/ProductService.ts";
import { ProducerStoreService } from "../../server/services/ProducerStoreService.ts";
const id = randomUUID(),
  userId = randomUUID(),
  png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function app(role: string | null = "producer") {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.actor = role
      ? {
          userId,
          email: "local@example.test",
          roles: [role],
          personId: randomUUID(),
          fullName: "Local",
        }
      : null;
    req.requestId = randomUUID();
    req.clientIpHash = "a".repeat(64);
    next();
  });
  a.use("/v1", producerStoreRouter, discoveryRouter);
  return a;
}
function mutation(r: request.Test) {
  return r
    .set("Sec-Fetch-Site", "same-origin")
    .set(
      "Cookie",
      "hvm_access=local; hvm_portal_role=producer; hvm_reauth=local",
    );
}
beforeEach(() => vi.mocked(verifyRecentAuthProof).mockReturnValue(true));
afterEach(() => vi.restoreAllMocks());
describe("Guardas HTTP dos slides e fotos", () => {
  it("upload raw mantém identidade autenticada e metadados validados", async () => {
    const upload = vi
      .spyOn(StoreMediaService, "upload")
      .mockResolvedValue({} as any);
    const command = randomUUID();
    const r = await mutation(
      request(app()).post(
        `/v1/producer/store/${id}/media/upload?purpose=cover&expectedRevision=1&commandId=${command}&media=1`,
      ),
    )
      .set("Content-Type", "image/png")
      .send(png);
    expect(r.status).toBe(200);
    expect(upload.mock.calls[0]?.slice(0, 3)).toEqual([
      id,
      userId,
      { purpose: "cover", expectedRevision: 1, commandId: command },
    ]);
    expect(upload.mock.calls[0]?.[3]).toEqual(png);
  });
  it.each([null, "consumer"])(
    "impede upload fora do portal produtor: %s",
    async (role) => {
      const upload = vi.spyOn(StoreMediaService, "upload");
      expect(
        (
          await mutation(
            request(app(role)).post(`/v1/producer/store/${id}/media/upload`),
          )
            .set("Content-Type", "image/png")
            .send(png)
        ).status,
      ).toBe(role ? 403 : 401);
      expect(upload).not.toHaveBeenCalled();
    },
  );
  it("recusa CSRF e exige autenticação recente antes de consumir arquivo", async () => {
    const upload = vi.spyOn(StoreMediaService, "upload");
    expect(
      (
        await request(app())
          .post(`/v1/producer/store/${id}/media/upload`)
          .set("Sec-Fetch-Site", "cross-site")
          .set("Content-Type", "image/png")
          .send(png)
      ).status,
    ).toBe(403);
    vi.mocked(verifyRecentAuthProof).mockReturnValue(false);
    expect(
      (
        await mutation(
          request(app()).post(`/v1/producer/store/${id}/media/upload`),
        )
          .set("Content-Type", "image/png")
          .send(png)
      ).body.error,
    ).toBe("RECENT_AUTH_REQUIRED");
    expect(upload).not.toHaveBeenCalled();
  });
  it("rejeita parâmetros duplicados, campos de outro titular e conteúdo não suportado", async () => {
    const upload = vi.spyOn(StoreMediaService, "upload");
    const q = `purpose=cover&expectedRevision=1&commandId=${randomUUID()}`;
    for (const extra of [
      "&purpose=avatar",
      "&storeId=" + randomUUID(),
      "&expectedRevision=2",
    ])
      expect(
        (
          await mutation(
            request(app()).post(
              `/v1/producer/store/${id}/media/upload?${q}${extra}`,
            ),
          )
            .set("Content-Type", "image/png")
            .send(png)
        ).status,
      ).toBe(400);
    expect(
      (
        await mutation(
          request(app()).post(`/v1/producer/store/${id}/media/upload?${q}`),
        )
          .set("Content-Type", "image/svg+xml")
          .send("<svg/>")
      ).status,
    ).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });
  it("destaques públicos aceitam região/página e rejeitam IDs repetidos ou GPS", async () => {
    const list = vi
      .spyOn(ProductService, "listHighlights")
      .mockResolvedValue({ products: [], page: 1, hasMore: false });
    expect(
      (
        await request(app(null)).get(
          `/v1/discovery/highlights?municipalityId=${id}&page=1`,
        )
      ).status,
    ).toBe(200);
    expect(list).toHaveBeenCalledWith({ municipalityId: id, page: 1 });
    for (const q of [
      "page=0",
      "page=1&page=2",
      "municipalityId=" + id + "&municipalityId=" + randomUUID(),
      "latitude=-9.91",
      "storeId=" + id,
    ])
      expect(
        (await request(app(null)).get("/v1/discovery/highlights?" + q)).status,
      ).toBe(400);
    expect(list).toHaveBeenCalledTimes(1);
  });
  it("clientes antigos recebem contrato anterior e media=1 inclui os campos novos", async () => {
    const store = {
      name: "Local",
      coverMode: "mixed",
      coverImages: [],
      publicProducerName: "Produtor Local",
    };
    vi.spyOn(ProducerStoreService, "getPublicStore").mockResolvedValue(
      store as any,
    );
    expect(
      (await request(app(null)).get("/v1/stores/loja-local")).body,
    ).toEqual({ name: "Local" });
    expect(
      (await request(app(null)).get("/v1/stores/loja-local?media=1")).body,
    ).toEqual(store);
  });
});
