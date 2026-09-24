import { describe, expect, it } from "vitest";
import {
  AcceptInviteSchema,
  AdminEmailConfirmationRequestSchema,
  AdminEmailConfirmationVerifySchema,
  AdminLoginSchema,
  BootstrapRequestSchema,
  CreateInviteSchema,
  MfaVerifySchema,
} from "../../shared/contracts/adminGovernance.ts";

const strong = "SenhaForte#123";

describe("Trilha 05 — contratos de governança administrativa", () => {
  it("valida confirmação administrativa com e-mail e OTP de oito dígitos", () => {
    expect(
      AdminEmailConfirmationRequestSchema.safeParse({
        email: "admin@example.com",
      }).success,
    ).toBe(true);
    expect(
      AdminEmailConfirmationVerifySchema.safeParse({
        email: "admin@example.com",
        otp: "01234567",
      }).success,
    ).toBe(true);
    expect(
      AdminEmailConfirmationVerifySchema.safeParse({
        email: "admin@example.com",
        otp: "12345",
      }).success,
    ).toBe(false);
  });

  it("mantém login estrito e MFA com oito dígitos", () => {
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
        otp: "01234567",
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
        email: "gestao@example.com",
        targetCpf: "52998224725",
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

  it("preserva senha forte no bootstrap e na credencial administrativa separada", () => {
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
      AcceptInviteSchema.safeParse({
        token: "a".repeat(64),
        cpf: base.cpf,
        password: strong,
        commandId: base.commandId,
      }).success,
    ).toBe(true);
    expect(
      AcceptInviteSchema.safeParse({ ...base, token: "curto" }).success,
    ).toBe(false);
  });
});

