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
    // A mensagem genérica de credencial administrativa continua obrigatória, mas
    // passou a vir de shared/accountBlock + fallback local depois da separação das
    // portas de acesso (T11). O texto literal abaixo é a única resposta para
    // credencial inválida — nenhum código interno pode vazar para a tela.
    expect(adminLogin).toContain(
      "Não foi possível autenticar. Confira o e-mail e a senha do perfil administrativo.",
    );
    expect(adminLogin).not.toContain("invalid_credentials");
    expect(adminLogin).not.toContain("ADMIN_GOVERNANCE_LOGIN_REQUIRED");
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

    const confirmationIndex = productionRows.findIndex(
      (row) => row.name === "trilha05_admin_email_verification",
    );
    productionRows[confirmationIndex] = {
      ...productionRows[confirmationIndex],
      version: "20260924115207",
    };

    const recoveryRevokeIndex = productionRows.findIndex(
      (row) => row.name === "auth_recovery_session_revoke",
    );
    productionRows[recoveryRevokeIndex] = {
      ...productionRows[recoveryRevokeIndex],
      version: "20260924124802",
    };

    expect(validateHistory(productionRows)).toBe(manifest.schemaVersion);

    const unknownRows = productionRows.map((row) => ({ ...row }));
    unknownRows[hardeningIndex].version = "20260923999999";
    expect(() => validateHistory(unknownRows)).toThrow(
      "REMOTE_MIGRATION_HISTORY_MISMATCH",
    );
  });

  it("alinha readiness ao schema lógico efetivo da T05", () => {
    expect(manifest.schemaVersion).toBeGreaterThanOrEqual(25);
    expect(FOUNDATION_SCHEMA_VERSION).toBe(manifest.schemaVersion);
  });

  it("mantém as portas administrativas separadas do cadastro público", () => {
    const resolver = readFileSync(
      "supabase/migrations/20261001002017_admin_portal_separation.sql",
      "utf8",
    );
    expect(resolver).not.toContain("linked_person_email");
    expect(resolver).not.toContain("app_people");
    expect(resolver).toContain("app_admin_principals");

    const service = readFileSync(
      "server/services/AdminGovernanceService.ts",
      "utf8",
    );
    expect(service).not.toContain("canonicalPortal");
    expect(service).not.toContain("loginHints");
    expect(service).toContain("wrong_portal_super");

    const routes = readFileSync(
      "server/routes/adminGovernanceRoutes.ts",
      "utf8",
    );
    expect(routes).toContain("result.role !== parsed.data.portalRole");
  });
});
