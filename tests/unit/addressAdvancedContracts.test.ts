import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CreateAddressAdvancedSchema,
  QUICK_ADDRESS_LABELS,
  UpdateAddressAdvancedSchema,
} from "../../shared/contracts/addressAdvanced";

function validAddress(overrides: Record<string, unknown> = {}) {
  return {
    cep: "76870-000",
    street: "Rua das Hortas",
    neighborhood: "Centro",
    city: "Ariquemes",
    state: "RO",
    commandId: crypto.randomUUID(),
    ...overrides,
  };
}

describe("endereços avançados", () => {
  it("normaliza CEP para oito dígitos", () => {
    expect(CreateAddressAdvancedSchema.parse(validAddress()).cep).toBe("76870000");
  });

  it("aplica rótulo, número e padrão seguros", () => {
    const value = CreateAddressAdvancedSchema.parse(validAddress());
    expect(value.label).toBe("Casa");
    expect(value.number).toBe("S/N");
    expect(value.isDefault).toBe(false);
  });

  it("rejeita campos extras por contrato strict", () => {
    expect(
      CreateAddressAdvancedSchema.safeParse(validAddress({ admin: true })).success,
    ).toBe(false);
  });

  it("rejeita latitude fora de -90 a 90", () => {
    expect(
      CreateAddressAdvancedSchema.safeParse(
        validAddress({ latitude: -91, longitude: -63.03 }),
      ).success,
    ).toBe(false);
  });

  it("rejeita longitude fora de -180 a 180", () => {
    expect(
      CreateAddressAdvancedSchema.safeParse(
        validAddress({ latitude: -9.91, longitude: 181 }),
      ).success,
    ).toBe(false);
  });

  it("exige latitude e longitude em par", () => {
    expect(
      CreateAddressAdvancedSchema.safeParse(
        validAddress({ latitude: -9.91 }),
      ).success,
    ).toBe(false);
  });

  it("limita deliveryNotes a 255 caracteres", () => {
    expect(
      CreateAddressAdvancedSchema.safeParse(
        validAddress({ deliveryNotes: "x".repeat(256) }),
      ).success,
    ).toBe(false);
  });

  it("update exige ao menos um campo mutável", () => {
    expect(
      UpdateAddressAdvancedSchema.safeParse({
        expectedRevision: 1,
        commandId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
  });

  it("editar instruções não redefine rótulo nem número", () => {
    const parsed = UpdateAddressAdvancedSchema.parse({
      deliveryNotes: "Chamar no interfone",
      expectedRevision: 1,
      commandId: crypto.randomUUID(),
    });
    expect(parsed).not.toHaveProperty("label");
    expect(parsed).not.toHaveProperty("number");
  });

  it("preserva rótulos, limite 10 e fingerprint canônicos", () => {
    expect([...QUICK_ADDRESS_LABELS]).toEqual([
      "Casa",
      "Trabalho",
      "Sítio Pessoal",
      "Comercial",
    ]);
    const migration = readFileSync(
      "supabase/migrations/20260925153500_trilha07_address_geocoding.sql",
      "utf8",
    );
    expect(migration).toContain("active_count >= 10");
    expect(migration).toContain("fingerprint_sha256");
    expect(migration).toContain("extensions.digest");
  });
});
