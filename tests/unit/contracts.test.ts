import { describe, it, expect } from "vitest";
import { validCpf, RegisterProducerSchema } from "../../shared/contracts/auth";
import { resolveDbUrl, buildRuntime } from "../../server/config/runtime";
import { parseArgs } from "../../scripts/args";
import { scrub } from "../../server/config/reportFailure";
describe("contratos e limites de confiança", () => {
  it.each(["11111111111", "00000000000", "52998224724", "abc"])(
    "rejeita CPF inválido %s",
    (v) => expect(validCpf(v)).toBe(false),
  );
  it("valida DV e normaliza cadastro", () => {
    const data = RegisterProducerSchema.parse({
      fullName: "Produtor de Teste",
      cpf: "529.982.247-25",
      email: " TEST@EXAMPLE.COM ",
      phone: "+5569999999999",
      password: "a-secure-test-password",
      brandName: "Produção de Teste",
      activityType: "misto",
    });
    expect(data.cpf).toBe("52998224725");
    expect(data.email).toBe("test@example.com");
  });
  it("rejeita injeção de papéis", () => {
    expect(
      RegisterProducerSchema.safeParse({ role: "platform_super_admin" })
        .success,
    ).toBe(false);
  });
  it("não aceita alias em produção mesmo quando URL canônica existe", () => {
    expect(
      resolveDbUrl(
        {
          SUPABASE_DB_URL:
            "postgresql://postgres.ref:pass@aws-0-test.pooler.supabase.com:6543/postgres",
          DATABASE_URL: "legacy",
        },
        "production",
      ).url,
    ).toBeNull();
  });
  it.each([
    "postgresql://user:pass@host/db",
    "postgresql://postgres.ref:pass@db.test.supabase.co:5432/postgres",
    "postgresql://postgres.ref:pass@aws.pooler.supabase.com:5432/postgres",
    "host=db password=example",
  ])("rejeita pooler inválido", (url) =>
    expect(resolveDbUrl({ SUPABASE_DB_URL: url }).url).toBeNull(),
  );
  it("aceita exclusivamente o pooler transacional", () =>
    expect(
      resolveDbUrl({
        SUPABASE_DB_URL:
          "postgresql://postgres.ref:pass@aws.pooler.supabase.com:6543/postgres",
      }).reason,
    ).toBeNull());
  it("VERCEL_ENV não pode ser rebaixado por APP_ENV", () =>
    expect(
      buildRuntime({ VERCEL_ENV: "production", APP_ENV: "development" }).appEnv,
    ).toBe("production"));
  it("aceita os dois estilos de argumentos do manual", () =>
    expect(parseArgs(["--tag=x", "--sha", "abc"])).toEqual({
      tag: "x",
      sha: "abc",
    }));
  it("remove PII e credenciais de mensagens", () => {
    const value = scrub(
      "postgresql://x:secret@db/db test@example.com 529.982.247-25 Bearer token",
    );
    expect(value).not.toContain("secret");
    expect(value).not.toContain("test@example.com");
    expect(value).not.toContain("529.982");
    expect(value).not.toContain("token");
  });
});
