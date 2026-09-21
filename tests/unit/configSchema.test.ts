import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  UpdateGlobalConfigPayloadSchema,
  UpdateGlobalConfigSchema,
} from "../../shared/contracts/adminConfig";

describe("UpdateGlobalConfigSchema", () => {
  const base = {
    expectedRevision: 1,
    commandId: randomUUID(),
    payload: { slogan: "Tudo fresco, tudo da terra." },
  };

  it("aceita payload mínimo válido", () => {
    expect(() => UpdateGlobalConfigSchema.parse(base)).not.toThrow();
  });

  it("aceita todos os campos válidos", () => {
    expect(() =>
      UpdateGlobalConfigSchema.parse({
        expectedRevision: 3,
        commandId: randomUUID(),
        payload: {
          slogan: "Do campo direto para a sua mesa.",
          defaultMunicipality: "Ariquemes",
          defaultState: "RO",
          supportEmail: "suporte@hortivitalmix.com",
          supportPhone: "+5563999999999",
        },
      }),
    ).not.toThrow();
  });

  it("rejeita payload com campo extra (strict)", () => {
    expect(() =>
      UpdateGlobalConfigPayloadSchema.parse({
        slogan: "Slogan válido para o teste",
        role: "platform_super_admin",
      }),
    ).toThrow();
  });

  it("rejeita entrada com campo extra no nível raiz", () => {
    expect(() =>
      UpdateGlobalConfigSchema.parse({
        ...base,
        actorId: randomUUID(),
      }),
    ).toThrow();
  });

  it("rejeita commandId não-UUID", () => {
    expect(() =>
      UpdateGlobalConfigSchema.parse({ ...base, commandId: "not-a-uuid" }),
    ).toThrow();
  });

  it("rejeita expectedRevision <= 0", () => {
    expect(() =>
      UpdateGlobalConfigSchema.parse({ ...base, expectedRevision: 0 }),
    ).toThrow();
  });

  it("rejeita UF inválida", () => {
    expect(() =>
      UpdateGlobalConfigSchema.parse({
        ...base,
        payload: { defaultState: "XX" },
      }),
    ).toThrow();
  });

  it("rejeita telefone fora do formato E.164", () => {
    expect(() =>
      UpdateGlobalConfigSchema.parse({
        ...base,
        payload: { supportPhone: "63999999999" },
      }),
    ).toThrow();
  });

  it("aceita supportPhone null (limpar)", () => {
    expect(() =>
      UpdateGlobalConfigSchema.parse({
        ...base,
        payload: { supportPhone: null },
      }),
    ).not.toThrow();
  });
});
