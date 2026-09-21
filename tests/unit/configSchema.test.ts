import { describe, expect, it } from "vitest";
import {
  GlobalConfigAdminResponseSchema,
  UpdateGlobalConfigSchema,
} from "../../shared/contracts/adminConfig";

describe("Trilha 02 — contrato de configuração", () => {
  const valid = {
    expectedRevision: 1,
    commandId: "11111111-1111-4111-8111-111111111111",
    payload: {
      slogan: "Tudo fresco. Tudo da sua região.",
      defaultMunicipality: "Ariquemes",
      defaultState: "RO",
      supportEmail: "SUPORTE@EXAMPLE.COM",
      supportPhone: "+5569999999999",
    },
  };

  it("normaliza e aceita apenas o payload canônico", () => {
    const parsed = UpdateGlobalConfigSchema.parse(valid);
    expect(parsed.payload.supportEmail).toBe("suporte@example.com");
    expect(parsed.payload.defaultState).toBe("RO");
  });

  it("rejeita campos administrativos injetados", () => {
    const result = UpdateGlobalConfigSchema.safeParse({
      ...valid,
      actorId: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.success).toBe(false);
  });

  it("exige revisão positiva, UUID e telefone E.164", () => {
    expect(
      UpdateGlobalConfigSchema.safeParse({
        ...valid,
        expectedRevision: 0,
        commandId: "not-a-uuid",
        payload: { supportPhone: "69999999999" },
      }).success,
    ).toBe(false);
  });

  it("valida a resposta administrativa completa", () => {
    expect(
      GlobalConfigAdminResponseSchema.safeParse({
        platformName: "HortiVitalMix",
        slogan: "Tudo fresco. Tudo da sua região.",
        defaultMunicipality: "Ariquemes",
        defaultState: "RO",
        currency: "BRL",
        timezone: "America/Porto_Velho",
        supportEmail: "hortivitalmix@gmail.com",
        supportPhone: null,
        revision: 1,
        updatedAt: "2026-09-20T20:00:00.000Z",
        updatedBy: null,
      }).success,
    ).toBe(true);
  });
});
