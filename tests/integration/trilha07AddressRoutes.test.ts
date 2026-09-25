import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/security/recentAuth.ts", () => ({
  verifyRecentAuthProof: vi.fn(() => true),
}));

import { profilePrivacyRouter } from "../../server/routes/profilePrivacyRoutes";
import {
  AddressManagementError,
  AddressManagementService,
} from "../../server/services/AddressManagementService";
import { verifyRecentAuthProof } from "../../server/security/recentAuth";

function app() {
  const server = express();
  server.use(express.json());
  server.use((req: any, _res, next) => {
    req.requestId = "t07-http";
    req.clientIpHash = "a".repeat(64);
    req.actor = {
      userId: "11111111-1111-4111-8111-111111111111",
      email: "pessoa@example.com",
      roles: ["consumer"],
    };
    next();
  });
  server.use("/v1", profilePrivacyRouter);
  return server;
}

const address = {
  id: "22222222-2222-4222-8222-222222222222",
  label: "Casa",
  cep: "76870000",
  street: "Rua A",
  number: "10",
  complement: null,
  neighborhood: "Centro",
  city: "Ariquemes",
  state: "RO",
  latitude: null,
  longitude: null,
  geocodingAccuracy: "none",
  deliveryNotes: null,
  isDefault: true,
  isActive: true,
  lastUsedAt: null,
  revision: 1,
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(verifyRecentAuthProof).mockReset();
  vi.mocked(verifyRecentAuthProof).mockReturnValue(true);
});

describe("rotas HTTP de endereço", () => {
  it("GET lista somente a coleção entregue pelo serviço", async () => {
    vi.spyOn(AddressManagementService, "listAddresses").mockResolvedValue([
      address as any,
    ]);
    const response = await request(app()).get("/v1/account/addresses");
    expect(response.status).toBe(200);
    expect(response.body.addresses).toHaveLength(1);
  });

  it("POST exige prova recente antes da mutação", async () => {
    vi.mocked(verifyRecentAuthProof).mockReturnValueOnce(false);
    const response = await request(app())
      .post("/v1/account/addresses")
      .set("X-HVM-Request", "1")
      .set("Cookie", "hvm_access=fake; hvm_reauth=fake")
      .send({
        cep: "76870000",
        street: "Rua A",
        neighborhood: "Centro",
        city: "Ariquemes",
        state: "RO",
        commandId: crypto.randomUUID(),
      });
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("RECENT_AUTH_REQUIRED");
  });

  it("PATCH de edição traduz conflito de revisão em HTTP 409", async () => {
    vi.spyOn(AddressManagementService, "updateAddress").mockResolvedValue({
      status: "conflict",
      currentRevision: 2,
    } as any);
    const response = await request(app())
      .patch("/v1/account/addresses/" + address.id)
      .set("Sec-Fetch-Site", "same-origin")
      .set("Cookie", "hvm_access=fake; hvm_reauth=fake")
      .send({
        label: "Trabalho",
        expectedRevision: 1,
        commandId: crypto.randomUUID(),
      });
    expect(response.status).toBe(409);
    expect(response.body.currentRevision).toBe(2);
  });

  it("POST traduz limite do banco em HTTP 422 amigável", async () => {
    vi.spyOn(AddressManagementService, "createAddress").mockRejectedValue(
      new AddressManagementError(
        "ADDRESS_LIMIT_EXCEEDED",
        422,
        "Limite de 10 endereços atingido. Remova um.",
      ),
    );
    const response = await request(app())
      .post("/v1/account/addresses")
      .set("Sec-Fetch-Site", "same-origin")
      .set("Cookie", "hvm_access=fake; hvm_reauth=fake")
      .send({
        cep: "76870000",
        street: "Rua A",
        neighborhood: "Centro",
        city: "Ariquemes",
        state: "RO",
        commandId: crypto.randomUUID(),
      });
    expect(response.status).toBe(422);
    expect(response.body.error).toBe("ADDRESS_LIMIT_EXCEEDED");
  });

  it("DELETE encaminha expectedRevision e preserva o modo retornado", async () => {
    const remove = vi
      .spyOn(AddressManagementService, "deleteAddress")
      .mockResolvedValue({
        status: "deleted",
        mode: "hard",
        wasDefault: false,
        replacementDefaultId: null,
      } as any);
    const response = await request(app())
      .delete("/v1/account/addresses/" + address.id)
      .set("Sec-Fetch-Site", "same-origin")
      .set("Cookie", "hvm_access=fake; hvm_reauth=fake")
      .send({
        expectedRevision: 1,
        commandId: crypto.randomUUID(),
      });
    expect(response.status).toBe(200);
    expect(response.body.mode).toBe("hard");
    expect(remove.mock.calls[0]?.[3]).toBe(1);
  });
});
