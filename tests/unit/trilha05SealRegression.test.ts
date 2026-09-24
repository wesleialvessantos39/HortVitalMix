import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FOUNDATION_SCHEMA_VERSION } from "../../shared/contracts/foundation.ts";
import { validateHistory } from "../../scripts/migrations-manifest.ts";

type MigrationRow = { version: string; name: string };

const manifest = JSON.parse(
  readFileSync("supabase/manifest.json", "utf8"),
) as {
  schemaVersion: number;
  migrations: MigrationRow[];
};

describe("Trilha 05 — regressões de selagem v11", () => {
  it("fecha o endpoint legado sem criar caminho alternativo para sessão administrativa", () => {
    const authRoutes = readFileSync("server/routes/authRoutes.ts", "utf8");
    const account = readFileSync("src/components/Account.tsx", "utf8");

    expect(authRoutes).toContain('authRouter.post("/admin-login"');
    expect(authRoutes).toContain('"ADMIN_GOVERNANCE_LOGIN_REQUIRED"');
    expect(authRoutes).not.toContain('handleLoginRequest(req, res, next, "admin")');
    expect(account).not.toContain('"/v1/auth/admin-login"');
  });

  it("não expõe códigos internos nas mensagens administrativas", () => {
    const account = readFileSync("src/components/Account.tsx", "utf8");
    const bootstrap = readFileSync("src/pages/admin/AdminBootstrapPage.tsx", "utf8");
    const adminLogin = readFileSync("src/pages/admin/AdminLoginPage.tsx", "utf8");
    const app = readFileSync("src/App.tsx", "utf8");
    const router = readFileSync("src/pages/admin/AdminRouter.tsx", "utf8");

    expect(account).not.toContain("Falha não identificada no cadastro:");
    expect(account).not.toContain("Código de atendimento:");
    expect(bootstrap).toContain("Cadastro não autorizado.");
    expect(adminLogin).toContain("Dados inválidos ou cadastro não autorizado.");
    expect(app).toContain('path === "/acesso/administracao"');
    expect(router).toContain('path==="/acesso/administracao"');
  });

  it("reconcilia somente os aliases físicos conhecidos das migrations T05", () => {
    const productionRows = manifest.migrations.map((migration) => ({
      version: migration.version,
      name: migration.name,
    }));
    const hardeningIndex = productionRows.findIndex(
      (row) => row.name === "trilha05_performance_hardening",
    );
    productionRows[hardeningIndex] = {
      ...productionRows[hardeningIndex],
      version: "20260923022554",
    };

    const principalsIndex = productionRows.findIndex(
      (row) => row.name === "trilha05_admin_principals",
    );
    productionRows[principalsIndex] = {
      ...productionRows[principalsIndex],
      version: "20260924023250",
    };

    expect(validateHistory(productionRows)).toBe(22);

    const unknownRows = productionRows.map((row) => ({ ...row }));
    unknownRows[hardeningIndex].version = "20260923999999";
    expect(() => validateHistory(unknownRows)).toThrow(
      "REMOTE_MIGRATION_HISTORY_MISMATCH",
    );
  });

  it("alinha readiness ao schema lógico efetivo da T05", () => {
    expect(manifest.schemaVersion).toBe(22);
    expect(FOUNDATION_SCHEMA_VERSION).toBe(22);
  });
});
