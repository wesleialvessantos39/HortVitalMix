import { describe, expect, it } from "vitest";
import { redactPII } from "../../server/security/redactPII";

describe("Trilha 02 — redactPII", () => {
  it("redige chaves de e-mail, telefone e credenciais", () => {
    const out = redactPII({
      supportEmail: "pessoa@example.com",
      supportPhone: "+5569999999999",
      token: "abc",
      nested: { password: "segredo", safe: "ok" },
    });
    expect(out).toEqual({
      supportEmail: "[REDACTED]",
      supportPhone: "[REDACTED]",
      token: "[REDACTED]",
      nested: { password: "[REDACTED]", safe: "ok" },
    });
  });

  it("redige PII encontrada em strings livres", () => {
    expect(
      redactPII("CPF 123.456.789-09 e contato pessoa@example.com"),
    ).toBe("CPF [CPF_REDACTED] e contato [EMAIL_REDACTED]");
  });

  it("redige connection string e bearer token", () => {
    const result = redactPII(
      "postgresql://user:pass@db.example/db Bearer eyJhbGciOiJIUzI1NiJ9.token.signature",
    );
    expect(result).not.toContain("user:pass");
    expect(result).not.toContain("eyJhbGci");
  });

  it("preserva valores não sensíveis e arrays", () => {
    expect(redactPII([{ municipality: "Ariquemes" }, 42])).toEqual([
      { municipality: "Ariquemes" },
      42,
    ]);
  });
});
