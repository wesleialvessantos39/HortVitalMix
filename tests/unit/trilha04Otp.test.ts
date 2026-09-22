import { describe, expect, it } from "vitest";
import {
  digestToken,
  generateOtp,
  generateOtpSalt,
  generateToken,
  hashOtp,
  verifyOtpHash,
} from "../../server/security/otp.ts";

describe("Trilha 04 — OTP criptográfico", () => {
  it("gera OTP sempre com seis dígitos, preservando zeros à esquerda", () => {
    for (let i = 0; i < 100; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
  });

  it("gera salt de 16 bytes e token opaco de 32 bytes", () => {
    expect(generateOtpSalt()).toMatch(/^[0-9a-f]{32}$/);
    expect(generateToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("persiste apenas hash/digest e valida OTP em tempo constante", () => {
    const otp = "004281";
    const salt = generateOtpSalt();
    const hash = hashOtp(otp, salt);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(otp);
    expect(verifyOtpHash(otp, salt, hash)).toBe(true);
    expect(verifyOtpHash("004282", salt, hash)).toBe(false);
    expect(digestToken("a".repeat(64))).toMatch(/^[0-9a-f]{64}$/);
  });
});
