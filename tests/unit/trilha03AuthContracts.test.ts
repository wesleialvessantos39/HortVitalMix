import { describe, expect, it } from "vitest";
import { LoginSchema, RegisterConsumerSchema, RegisterProducerSchema, validCpf } from "../../shared/contracts/auth";

const base = {
  fullName: "Pessoa Teste",
  cpf: "529.982.247-25",
  email: "Pessoa.Teste@EXAMPLE.com",
  phone: "(69) 99999-8888",
  password: "SenhaForte#2026",
};

describe("Trilha 03 — contratos de identidade", () => {
  it("valida CPF matematicamente", () => {
    expect(validCpf("52998224725")).toBe(true);
    expect(validCpf("11111111111")).toBe(false);
    expect(validCpf("52998224724")).toBe(false);
  });
  it("normaliza consumidor", () => {
    const parsed = RegisterConsumerSchema.parse(base);
    expect(parsed.cpf).toBe("52998224725");
    expect(parsed.email).toBe("pessoa.teste@example.com");
    expect(parsed.phone).toBe("+5569999998888");
  });
  it("rejeita injeção de papel administrativo", () => {
    expect(RegisterConsumerSchema.safeParse({ ...base, roleCode: "platform_admin" }).success).toBe(false);
  });
  it("produtor exige campos próprios", () => {
    expect(RegisterProducerSchema.safeParse({ ...base, propertyName: "Sítio Esperança", activityType: "misto" }).success).toBe(true);
    expect(RegisterProducerSchema.safeParse(base).success).toBe(false);
  });
  it("login exige papel explícito", () => {
    expect(LoginSchema.safeParse({ email: base.email, password: base.password, portalRole: "consumer" }).success).toBe(true);
    expect(LoginSchema.safeParse({ email: base.email, password: base.password }).success).toBe(false);
  });
});
