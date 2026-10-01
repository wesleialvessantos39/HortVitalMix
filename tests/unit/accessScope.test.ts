import { describe, expect, it } from "vitest";
import {
  PartialBlockListSchema,
  PartialBlockMutationResultSchema,
  PartialBlockSchema,
  PartialBlockSubjectLookupSchema,
  LocalityMutationResultSchema,
  MunicipalityImpactSchema,
  RevokePartialBlockSchema,
} from "../../shared/contracts/locality";

const blockId = "0d5b9a1e-6f9a-4a26-9f2b-6f2f6a1b7c10";
const userId = "b3a3c0de-1d5f-4a3b-8a0f-6c4c1e2f9d22";

describe("escopo de acesso — resultados de bloqueio parcial", () => {
  it("01 bloqueio ativo carrega sujeito, alcance e coleções", () => {
    const parsed = PartialBlockSchema.parse({
      id: blockId,
      userId,
      subject: "producer_publishing",
      scope: "custom",
      reason: "denuncia_analisada",
      isActive: true,
      municipalityIds: [blockId],
      propertyIds: [userId],
      createdAt: "2026-10-01T12:00:00.000Z",
      revokedAt: null,
    });
    expect(parsed.isActive).toBe(true);
    expect(parsed.municipalityIds).toHaveLength(1);
  });

  it("02 união discriminada cobre os desfechos de mutação", () => {
    expect(
      PartialBlockMutationResultSchema.parse({ status: "revoked" }).status,
    ).toBe("revoked");
    expect(
      PartialBlockMutationResultSchema.safeParse({ status: "unknown" }).success,
    ).toBe(false);
  });

  it("03 revisão exige motivo opcional curto e commandId", () => {
    expect(
      RevokePartialBlockSchema.safeParse({ commandId: blockId }).success,
    ).toBe(true);
    expect(
      RevokePartialBlockSchema.safeParse({
        commandId: blockId,
        reason: "ok",
      }).success,
    ).toBe(false);
  });

  it("04 lista de bloqueios aceita conjunto vazio", () => {
    expect(PartialBlockListSchema.parse({ blocks: [] }).blocks).toEqual([]);
  });
});

describe("escopo de acesso — localização do titular", () => {
  it("05 titular não encontrado devolve registro nulo", () => {
    expect(
      PartialBlockSubjectLookupSchema.parse({ found: false, user: null }).found,
    ).toBe(false);
  });

  it("06 titular encontrado exige identificadores completos", () => {
    const parsed = PartialBlockSubjectLookupSchema.parse({
      found: true,
      user: {
        userId,
        personId: blockId,
        fullName: "Maria da Silva",
        cpf: "52998224725",
        email: "maria@exemplo.com",
        status: "active",
        publicRoles: ["producer"],
        municipalityId: blockId,
        municipalityName: "Ariquemes",
        municipalityState: "RO",
      },
    });
    expect(parsed.user?.publicRoles).toEqual(["producer"]);
  });
});

describe("escopo de acesso — resultado da gestão de localidades", () => {
  it("07 conflito de revisão informa a revisão corrente", () => {
    expect(
      LocalityMutationResultSchema.parse({
        status: "conflict",
        currentRevision: 4,
      }).currentRevision,
    ).toBe(4);
  });

  it("08 impacto da desativação é sempre não negativo", () => {
    expect(
      MunicipalityImpactSchema.safeParse({
        municipalityId: blockId,
        isActive: true,
        people: 12,
        properties: 3,
        deliveryScopes: 2,
        partialBlocks: 0,
      }).success,
    ).toBe(true);
    expect(
      MunicipalityImpactSchema.safeParse({
        municipalityId: blockId,
        isActive: true,
        people: -1,
        properties: 0,
        deliveryScopes: 0,
        partialBlocks: 0,
      }).success,
    ).toBe(false);
  });
});
