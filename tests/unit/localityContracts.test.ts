import { describe, expect, it } from "vitest";
import {
  CreateMunicipalitySchema,
  CreatePartialBlockSchema,
  DeliveryScopeModeSchema,
  LOCALITY_DISABLED_MESSAGE,
  LOCALITY_NOT_COVERED_MESSAGE,
  LocalityCoverageQuerySchema,
  LocalityCoverageSchema,
  MunicipalityNameSchema,
  ProducerDeliveryScopeSchema,
  UpdateMunicipalitySchema,
  UpdateProducerDeliveryScopeSchema,
  localityBlockedMessage,
} from "../../shared/contracts/locality";

const commandId = "3f1c8cbc-4a2c-4f0e-9c6c-2f3cb0a3a9d1";

describe("localidade — contratos de cobertura", () => {
  it("01 aceita apenas os três estados de cobertura", () => {
    expect(LocalityCoverageSchema.options).toEqual([
      "active",
      "inactive",
      "unknown",
    ]);
    expect(LocalityCoverageSchema.safeParse("disabled").success).toBe(false);
  });

  it("02 normaliza a UF para maiúsculas na consulta de cobertura", () => {
    const parsed = LocalityCoverageQuerySchema.parse({
      state: "ro",
      municipality: "Machadinho D'Oeste",
    });
    expect(parsed.state).toBe("RO");
  });

  it("03 exige município com pelo menos três caracteres", () => {
    expect(MunicipalityNameSchema.safeParse("Oi").success).toBe(false);
    expect(MunicipalityNameSchema.safeParse("Rio Crespo").success).toBe(true);
  });

  it("04 mensagem de região desativada é literal e com o e-mail de contato", () => {
    expect(LOCALITY_DISABLED_MESSAGE).toBe(
      "essa região está desativada, dúvidas entre em contato conosco hortivitalmix@gmail.com",
    );
    expect(localityBlockedMessage("inactive")).toBe(LOCALITY_DISABLED_MESSAGE);
  });

  it("05 localidade fora do catálogo usa a mensagem de ausência de cobertura", () => {
    expect(localityBlockedMessage("unknown")).toBe(LOCALITY_NOT_COVERED_MESSAGE);
  });
});

describe("localidade — gestão do Super administrador", () => {
  it("06 cadastro exige código IBGE de sete dígitos", () => {
    expect(
      CreateMunicipalitySchema.safeParse({
        ibgeCode: "110002",
        name: "Ariquemes",
        state: "RO",
        commandId,
      }).success,
    ).toBe(false);
    expect(
      CreateMunicipalitySchema.safeParse({
        ibgeCode: "1100023",
        name: "Ariquemes",
        state: "RO",
        commandId,
      }).success,
    ).toBe(true);
  });

  it("07 atualização exige revisão e ao menos uma alteração", () => {
    expect(
      UpdateMunicipalitySchema.safeParse({
        expectedRevision: 1,
        commandId,
      }).success,
    ).toBe(false);
    expect(
      UpdateMunicipalitySchema.safeParse({
        isActive: false,
        expectedRevision: 1,
        commandId,
      }).success,
    ).toBe(true);
  });
});

describe("localidade — escopo de entrega do produtor", () => {
  it("08 modos canônicos do escopo", () => {
    expect(DeliveryScopeModeSchema.options).toEqual([
      "property_municipality",
      "all",
      "custom",
    ]);
  });

  it("09 escopo personalizado exige ao menos um município", () => {
    const base = {
      expectedRevision: 1,
      commandId,
    };
    expect(
      UpdateProducerDeliveryScopeSchema.safeParse({
        ...base,
        mode: "custom",
        municipalityIds: [],
      }).success,
    ).toBe(false);
    expect(
      UpdateProducerDeliveryScopeSchema.safeParse({
        ...base,
        mode: "custom",
        municipalityIds: [commandId],
      }).success,
    ).toBe(true);
  });

  it("10 escopo lido não aceita campos extras", () => {
    expect(
      ProducerDeliveryScopeSchema.safeParse({
        mode: "all",
        municipalityIds: [],
        revision: 1,
        extra: true,
      }).success,
    ).toBe(false);
  });
});

describe("localidade — bloqueio parcial", () => {
  const base = {
    userId: commandId,
    subject: "producer_publishing" as const,
    reason: "denuncia_analisada",
    commandId,
  };

  it("11 bloqueio personalizado de publicação exige municípios e imóveis", () => {
    expect(
      CreatePartialBlockSchema.safeParse({
        ...base,
        scope: "custom",
        municipalityIds: [],
        propertyIds: [],
      }).success,
    ).toBe(false);
    expect(
      CreatePartialBlockSchema.safeParse({
        ...base,
        scope: "custom",
        municipalityIds: [commandId],
        propertyIds: [commandId],
      }).success,
    ).toBe(true);
  });

  it("12 bloqueio de compra não usa imóveis", () => {
    expect(
      CreatePartialBlockSchema.safeParse({
        ...base,
        subject: "consumer_purchasing",
        scope: "custom",
        municipalityIds: [commandId],
        propertyIds: [commandId],
      }).success,
    ).toBe(false);
  });

  it("13 bloqueio total dispensa listas", () => {
    expect(
      CreatePartialBlockSchema.safeParse({
        ...base,
        scope: "all",
        municipalityIds: [],
        propertyIds: [],
      }).success,
    ).toBe(true);
  });

  it("14 motivo precisa de pelo menos três caracteres", () => {
    expect(
      CreatePartialBlockSchema.safeParse({
        ...base,
        scope: "all",
        reason: "ok",
      }).success,
    ).toBe(false);
  });
});
