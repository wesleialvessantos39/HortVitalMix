import { describe, it, expect, vi } from "vitest";
import {
  EmailRequestSchema,
  NewPasswordSchema,
  PasswordChangeSchema,
  RegisterProducerSchema,
  SessionImportSchema,
  formatBrazilMobile,
  formatCpf,
  validCpf,
} from "../../shared/contracts/auth";
import {
  resolveDbUrl,
  buildRuntime,
  logRuntimeBootSummary,
} from "../../server/config/runtime";
import { parseArgs } from "../../scripts/args";
import { hashMigrationContents } from "../../scripts/migrations-manifest";
import {
  scrub,
  reportFailure,
  classifyDbError,
} from "../../server/config/reportFailure";

describe("contratos e limites de confiança", () => {
  it.each(["11111111111", "00000000000", "52998224724", "abc"])(
    "rejeita CPF inválido %s",
    (value) => expect(validCpf(value)).toBe(false),
  );

  it("valida DV e normaliza cadastro", () => {
    const data = RegisterProducerSchema.parse({
      fullName: "Pessoa de Teste",
      grammaticalTreatment: "feminine",
      cpf: "529.982.247-25",
      email: " TEST@EXAMPLE.COM ",
      phone: "(69) 99999-9999",
      password: "a-secure-test-password",
      propertyName: "Sítio de Teste",
      activityType: "misto",
    });

    expect(data.cpf).toBe("52998224725");
    expect(data.email).toBe("test@example.com");
    expect(data.phone).toBe("+5569999999999");
    expect(data.grammaticalTreatment).toBe("feminine");
    expect(data.propertyName).toBe("Sítio de Teste");
  });

  it("aplica máscaras brasileiras de CPF e celular", () => {
    expect(formatCpf("52998224725")).toBe("529.982.247-25");
    expect(formatBrazilMobile("69993810921")).toBe("(69) 99381-0921");
    expect(formatBrazilMobile("+5569993810921")).toBe("(69) 99381-0921");
  });

  it("rejeita injeção de papéis", () => {
    expect(
      RegisterProducerSchema.safeParse({ role: "platform_super_admin" })
        .success,
    ).toBe(false);
  });

  it("normaliza e-mail nos fluxos de segurança", () => {
    expect(EmailRequestSchema.parse({ email: " TEST@EXAMPLE.COM " }).email).toBe(
      "test@example.com",
    );
  });

  it("exige senha de 12 caracteres e nonce numérico", () => {
    expect(NewPasswordSchema.safeParse({ password: "curta" }).success).toBe(false);
    expect(
      PasswordChangeSchema.safeParse({
        password: "SenhaNovaMuitoForte!2026",
        nonce: "123456",
      }).success,
    ).toBe(true);
    expect(
      PasswordChangeSchema.safeParse({
        password: "SenhaNovaMuitoForte!2026",
        nonce: "ABC123",
      }).success,
    ).toBe(false);
  });

  it("limita tamanho dos tokens importados", () => {
    expect(
      SessionImportSchema.safeParse({
        accessToken: "a".repeat(64),
        refreshToken: "r".repeat(32),
      }).success,
    ).toBe(true);
    expect(
      SessionImportSchema.safeParse({
        accessToken: "a".repeat(9000),
        refreshToken: "r".repeat(32),
      }).success,
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

  it("aceita exclusivamente o pooler transacional", () => {
    const resolved = resolveDbUrl({
      SUPABASE_DB_URL:
        "postgresql://postgres.ref:pass@aws.pooler.supabase.com:6543/postgres",
    });

    expect(resolved.reason).toBeNull();
    expect(resolved.source).toBe("SUPABASE_DB_URL");
  });

  it("VERCEL_ENV não pode ser rebaixado por APP_ENV", () =>
    expect(
      buildRuntime({ VERCEL_ENV: "production", APP_ENV: "development" }).appEnv,
    ).toBe("production"));

  it("aceita os dois estilos de argumentos do manual", () =>
    expect(parseArgs(["--tag=x", "--sha", "abc"])).toEqual({
      tag: "x",
      sha: "abc",
    }));

  it("migration_history_hash muda quando qualquer migration muda", () => {
    const original = hashMigrationContents([
      ["0001.sql", "SELECT 1;"],
      ["0002.sql", "SELECT 2;"],
    ]);
    const altered = hashMigrationContents([
      ["0001.sql", "SELECT 1;"],
      ["0002.sql", "SELECT 3;"],
    ]);

    expect(altered).not.toBe(original);
  });

  it("remove PII e credenciais de mensagens", () => {
    const value = scrub(
      "postgresql://x:secret@db/db test@example.com 529.982.247-25 +5569999999999 Bearer token",
    );

    expect(value).not.toContain("secret");
    expect(value).not.toContain("test@example.com");
    expect(value).not.toContain("529.982");
    expect(value).not.toContain("+5569");
    expect(value).not.toContain("token");
  });

  it("classifica migration ausente pelo código PostgreSQL", () => {
    expect(classifyDbError({ code: "42P01" })).toBe("db_migration_missing");
  });

  it("logRuntimeBootSummary não imprime valores sensíveis", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const current = buildRuntime({
      APP_ENV: "development",
      SUPABASE_URL: "https://abcdefgh.supabase.co",
      SUPABASE_ANON_KEY: "public-value",
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_NEVER_LOG_THIS",
      SUPABASE_JWT_SECRET: "jwt-secret-never-log",
      SUPABASE_PROJECT_REF: "abcdefgh",
      SUPABASE_DB_URL:
        "postgresql://postgres.abcdefgh:db-password@aws.pooler.supabase.com:6543/postgres",
      APP_IP_PEPPER: "a".repeat(64),
      OUTBOX_ENCRYPTION_KEY: "b".repeat(64),
    });

    logRuntimeBootSummary(current);
    const rendered = JSON.stringify(log.mock.calls);

    expect(rendered).not.toContain("NEVER_LOG_THIS");
    expect(rendered).not.toContain("jwt-secret-never-log");
    expect(rendered).not.toContain("db-password");
    expect(rendered).not.toContain("a".repeat(64));
    expect(rendered).not.toContain("b".repeat(64));

    log.mockRestore();
  });

  it("reportFailure estruturado redige detalhes", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    reportFailure({
      category: "db_unavailable",
      hostname: "db.example.com",
      detail:
        "postgresql://x:secret@db/db test@example.com +5569999999999",
      requestId: "request-test",
    });

    const rendered = JSON.stringify(error.mock.calls);
    expect(rendered).not.toContain("secret");
    expect(rendered).not.toContain("test@example.com");
    expect(rendered).not.toContain("+5569");

    error.mockRestore();
  });
});
