import { describe, expect, it } from "vitest";
import {
  decryptPayload,
  encryptPayload,
} from "../../server/communication/securePayload.ts";

describe("Trilha 04 — outbox AES-256-GCM", () => {
  const key = "11".repeat(32);

  it("cifra e decifra o payload sem persistir segredo em claro", () => {
    const secret = "otp-123456-token-super-secreto";
    const encrypted = encryptPayload(
      { to: "destino@example.com", text: secret },
      key,
    );
    expect(encrypted.nonceHex).toMatch(/^[0-9a-f]{24}$/);
    expect(encrypted.authTagHex).toMatch(/^[0-9a-f]{32}$/);
    expect(encrypted.ciphertext.toString("utf8")).not.toContain(secret);
    expect(
      decryptPayload(
        encrypted.ciphertext,
        encrypted.nonceHex,
        encrypted.authTagHex,
        key,
      ),
    ).toEqual({ to: "destino@example.com", text: secret });
  });

  it("falha fechado com chave inválida ou adulteração", () => {
    expect(() => encryptPayload({ text: "x" }, "abc")).toThrow();
    const encrypted = encryptPayload({ text: "x" }, key);
    expect(() =>
      decryptPayload(
        encrypted.ciphertext,
        encrypted.nonceHex,
        encrypted.authTagHex,
        "22".repeat(32),
      ),
    ).toThrow();
  });
});
