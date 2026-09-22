import { describe, expect, it } from "vitest";
import {
  ConfirmOtpSchema,
  ConfirmTokenSchema,
  RequestChallengeSchema,
  RequestPasswordRecoverySchema,
  ResetPasswordSchema,
  RoleScopedPasswordRecoveryRequestSchema,
  RoleScopedPasswordResetSchema,
} from "../../shared/contracts/contactRecovery.ts";

describe("Trilha 04 — contratos strict", () => {
  it("aceita somente canal canônico e OTP de seis dígitos", () => {
    expect(RequestChallengeSchema.safeParse({ channel: "email", commandId: crypto.randomUUID() }).success).toBe(true);
    expect(RequestChallengeSchema.safeParse({ channel: "whatsapp", commandId: crypto.randomUUID() }).success).toBe(false);
    expect(ConfirmOtpSchema.safeParse({ channel: "phone", otp: "001234", commandId: crypto.randomUUID() }).success).toBe(true);
    expect(ConfirmOtpSchema.safeParse({ channel: "phone", otp: "12345", commandId: crypto.randomUUID() }).success).toBe(false);
  });

  it("preserva contratos-base do Manual e extensão de papel já homologada", () => {
    expect(RequestPasswordRecoverySchema.safeParse({ email: "a@b.com", commandId: crypto.randomUUID() }).success).toBe(true);
    expect(RoleScopedPasswordRecoveryRequestSchema.safeParse({
      email: "a@b.com",
      commandId: crypto.randomUUID(),
      portalRole: "producer",
    }).success).toBe(true);
    expect(RoleScopedPasswordResetSchema.safeParse({
      token: "a".repeat(64),
      newPassword: "SenhaForte#123",
      portalRole: "consumer",
      flowToken: "b".repeat(64),
    }).success).toBe(true);
  });

  it("impõe token opaco e senha forte no reset", () => {
    expect(ConfirmTokenSchema.safeParse({ token: "a".repeat(64) }).success).toBe(true);
    expect(ResetPasswordSchema.safeParse({ token: "a".repeat(64), newPassword: "fraca" }).success).toBe(false);
  });
});
