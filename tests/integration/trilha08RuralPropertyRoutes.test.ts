import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/security/recentAuth.ts", () => ({
  verifyRecentAuthProof: vi.fn(() => true),
}));

import { ruralPropertyRouter } from "../../server/routes/ruralPropertyRoutes";
import {
  RuralPropertyError,
  RuralPropertyService,
} from "../../server/services/RuralPropertyService";
import { verifyRecentAuthProof } from "../../server/security/recentAuth";

const propertyId = "22222222-2222-4222-8222-222222222222";
const property = {
  id: propertyId,
  propertyName: "Chácara Boa Colheita",
  registrationNumber: null,
  totalAreaHectares: 10,
  cultivatedAreaHectares: 4,
  ruralZoneSector: "Gleba Jamari",
  lineVicinal: "Linha C-65",
  municipality: "Ariquemes",
  state: "RO",
  latitudeSede: -9.9132,
  longitudeSede: -63.0408,
  accessDirections: null,
  waterSource: "poco_artesiano",
  irrigationSystem: "gotejamento",
  status: "draft",
  wizardCurrentStep: 4,
  revision: 4,
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
  boundaries: [],
  activity: {
    id: "33333333-3333-4333-8333-333333333333",
    activityCategory: "misto",
    productionSystem: "agroecologico_declarado",
    hasWashingFacility: true,
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
  },
} as any;

function makeApp(role = "producer") {
  const server = express();
  server.use(express.json());
  server.use((req: any, _res, next) => {
    req.requestId = "11111111-1111-4111-8111-111111111111";
    req.clientIpHash = "a".repeat(64);
    req.actor = {
      userId: "44444444-4444-4444-8444-444444444444",
      email: "produtor@example.com",
      roles: [role],
    };
    next();
  });
  server.use("/v1", ruralPropertyRouter);
  return server;
}

function mutationHeaders(req: request.Test) {
  return req
    .set("Sec-Fetch-Site", "same-origin")
    .set("Cookie", "hvm_access=fake; hvm_reauth=fake");
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(verifyRecentAuthProof).mockReset();
  vi.mocked(verifyRecentAuthProof).mockReturnValue(true);
});

describe("T08 rotas de imóveis rurais", () => {
  it("01 lista apenas os imóveis retornados para o produtor autenticado", async () => {
    vi.spyOn(RuralPropertyService, "listProperties").mockResolvedValue([
      property,
    ]);
    const response = await request(makeApp()).get("/v1/producer/properties");
    expect(response.status).toBe(200);
    expect(response.body.properties).toHaveLength(1);
  });

  it("02 bloqueia acesso quando a sessão não possui papel producer", async () => {
    const response = await request(makeApp("consumer")).get(
      "/v1/producer/properties",
    );
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("PRODUCER_PROFILE_REQUIRED");
  });

  it("03 retorna detalhe somente pelo serviço escopado ao usuário", async () => {
    const get = vi
      .spyOn(RuralPropertyService, "getProperty")
      .mockResolvedValue(property);
    const response = await request(makeApp()).get(
      "/v1/producer/properties/" + propertyId,
    );
    expect(response.status).toBe(200);
    expect(response.body.property.id).toBe(propertyId);
    expect(get.mock.calls[0]?.[1]).toBe(propertyId);
  });

  it("04 rejeita UUID de imóvel inválido antes de consultar o serviço", async () => {
    const response = await request(makeApp()).get(
      "/v1/producer/properties/invalido",
    );
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("VALIDATION_ERROR");
  });

  it("05 exige hvm_reauth antes de salvar qualquer etapa", async () => {
    vi.mocked(verifyRecentAuthProof).mockReturnValueOnce(false);
    const response = await mutationHeaders(
      request(makeApp()).post("/v1/producer/properties/wizard/save-step"),
    ).send({
      step: 1,
      stepData: {
        propertyName: "Chácara Boa Colheita",
        lineVicinal: "Linha C-65",
        ruralZoneSector: "Gleba Jamari",
        municipality: "Ariquemes",
        state: "RO",
        latitudeSede: -9.9132,
        longitudeSede: -63.0408,
      },
      commandId: crypto.randomUUID(),
    });
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("RECENT_AUTH_REQUIRED");
  });

  it("06 cria o rascunho no passo 1 sem aceitar producerId do cliente", async () => {
    const save = vi
      .spyOn(RuralPropertyService, "saveWizardStep")
      .mockResolvedValue({
        status: "step_saved",
        property,
        nextStep: 2,
      } as any);
    const response = await mutationHeaders(
      request(makeApp()).post("/v1/producer/properties/wizard/save-step"),
    ).send({
      step: 1,
      stepData: {
        propertyName: "Chácara Boa Colheita",
        lineVicinal: "Linha C-65",
        ruralZoneSector: "Gleba Jamari",
        municipality: "Ariquemes",
        state: "RO",
        latitudeSede: -9.9132,
        longitudeSede: -63.0408,
      },
      commandId: crypto.randomUUID(),
    });
    expect(response.status).toBe(201);
    expect(save.mock.calls[0]?.[1]).toBe("producer");
    expect(save.mock.calls[0]?.[2]).not.toHaveProperty("producerId");
  });

  it("07 traduz conflito de revisão em HTTP 409", async () => {
    vi.spyOn(RuralPropertyService, "saveWizardStep").mockRejectedValue(
      new RuralPropertyError(
        "PROPERTY_REVISION_CONFLICT",
        409,
        "O imóvel foi alterado em outra sessão.",
      ),
    );
    const response = await mutationHeaders(
      request(makeApp()).post("/v1/producer/properties/wizard/save-step"),
    ).send({
      propertyId,
      expectedRevision: 4,
      step: 3,
      stepData: {
        waterSource: "poco_artesiano",
        irrigationSystem: "gotejamento",
      },
      commandId: crypto.randomUUID(),
    });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("PROPERTY_REVISION_CONFLICT");
  });

  it("08 submete somente com revisão, compromisso e prova recente", async () => {
    const submit = vi
      .spyOn(RuralPropertyService, "submitProperty")
      .mockResolvedValue({ status: "submitted", property } as any);
    const response = await mutationHeaders(
      request(makeApp()).post(
        "/v1/producer/properties/" + propertyId + "/submit",
      ),
    ).send({
      expectedRevision: 4,
      agroecologicalCommitment: true,
      commandId: crypto.randomUUID(),
    });
    expect(response.status).toBe(200);
    expect(submit.mock.calls[0]?.[2]).toBe(propertyId);
  });
});
