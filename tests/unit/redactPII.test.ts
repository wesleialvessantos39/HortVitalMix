import { describe, expect, it } from "vitest";
import { redactPII } from "../../server/security/redactPII";

describe("redactPII", () => {
  it("redige chaves com nome sensível", () => {
    const out = redactPII({
      userPassword: "senha123",
      apiToken: "abc",
      cpf: "11144477735",
      safe: "valor",
    }) as Record<string, unknown>;

    expect(out.userPassword).toBe("[REDACTED]");
    expect(out.apiToken).toBe("[REDACTED]");
    expect(out.cpf).toBe("[REDACTED]");
    expect(out.safe).toBe("valor");
  });

  it("redige strings dentro de valores", () => {
    const out = redactPII({
      message: "usuário 111.444.777-35 logado com email joao@example.com",
    }) as Record<string, string>;

    expect(out.message).toContain("[CPF_REDACTED]");
    expect(out.message).toContain("[EMAIL_REDACTED]");
  });

  it("percorre arrays", () => {
    const out = redactPII({
      items: [{ password: "x" }, { name: "ok" }],
    }) as { items: Record<string, unknown>[] };

    expect(out.items[0].password).toBe("[REDACTED]");
    expect(out.items[1].name).toBe("ok");
  });

  it("redige connection string", () => {
    const out = redactPII({
      detail: "failed to connect to postgresql://postgres:senha@host:5432/db",
    }) as Record<string, string>;

    expect(out.detail).toContain("[DB_URL_REDACTED]");
    expect(out.detail).not.toContain("senha");
  });
});
