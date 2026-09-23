import { describe, expect, it } from "vitest";
import {
  AcceptInviteSchema,
  AdminLoginSchema,
  BootstrapRequestSchema,
  CreateInviteSchema,
  MfaVerifySchema,
} from "../../shared/contracts/adminGovernance.ts";

const strong = "SenhaForte#123";

describe("Trilha 05 — contratos de governança administrativa", () => {
  it("mantém login estrito e MFA com seis dígitos", () => {
    expect(
      AdminLoginSchema.safeParse({ email: "admin@example.com", password: strong }).success,
    ).toBe(true);
    expect(
      AdminLoginSchema.safeParse({
        email: "admin@example.com",
        password: strong,
        role: "root",
      }).success,
    ).toBe(false);
    expect(
      MfaVerifySchema.safeParse({
        challengeId: crypto.randomUUID(),
        otp: "123456",
      }).success,
    ).toBe(true);
    expect(
      MfaVerifySchema.safeParse({
        challengeId: crypto.randomUUID(),
        otp: "12345",
      }).success,
    ).toBe(false);
  });

  it("impõe setores ao administrador setorial e proíbe setores no super administrador", () => {
    expect(
      CreateInviteSchema.safeParse({
        email: "setorial@example.com",
        targetRole: "platform_admin",
        sectors: ["catalog_moderation"],
        commandId: crypto.randomUUID(),
      }).success,
    ).toBe(true);
    expect(
      CreateInviteSchema.safeParse({
        email: "setorial@example.com",
        targetRole: "platform_admin",
        sectors: [],
        commandId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      CreateInviteSchema.safeParse({
        email: "super@example.com",
        targetRole: "platform_super_admin",
        sectors: [],
        commandId: crypto.randomUUID(),
      }).success,
    ).toBe(true);
    expect(
      CreateInviteSchema.safeParse({
        email: "super@example.com",
        targetRole: "platform_super_admin",
        sectors: ["finance_ops"],
        commandId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
  });

  it("preserva senha forte e token opaco de convite", () => {
    const base = {
      fullName: "Administrador Teste",
      cpf: "52998224725",
      phone: "(69) 99999-9999",
      password: strong,
      commandId: crypto.randomUUID(),
    };
    expect(
      BootstrapRequestSchema.safeParse({ ...base, email: "admin@example.com" }).success,
    ).toBe(true);
    expect(
      BootstrapRequestSchema.safeParse({
        ...base,
        email: "admin@example.com",
        password: "fraca",
      }).success,
    ).toBe(false);
    expect(
      AcceptInviteSchema.safeParse({ ...base, token: "a".repeat(64) }).success,
    ).toBe(true);
    expect(
      AcceptInviteSchema.safeParse({ ...base, token: "curto" }).success,
    ).toBe(false);
  });
});
