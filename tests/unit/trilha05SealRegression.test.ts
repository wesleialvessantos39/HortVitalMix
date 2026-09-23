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

  it("reconcilia somente o alias físico conhecido da migration T05", () => {
    const productionRows = manifest.migrations.map((migration) => ({
      version: migration.version,
      name: migration.name,
    }));
    productionRows[productionRows.length - 1] = {
      ...productionRows[productionRows.length - 1],
      version: "20260923022554",
    };

    expect(validateHistory(productionRows)).toBe(20);

    const unknownRows = productionRows.map((row) => ({ ...row }));
    unknownRows[unknownRows.length - 1].version = "20260923999999";
    expect(() => validateHistory(unknownRows)).toThrow(
      "REMOTE_MIGRATION_HISTORY_MISMATCH",
    );
  });

  it("alinha readiness ao schema lógico efetivo da T05", () => {
    expect(manifest.schemaVersion).toBe(20);
    expect(FOUNDATION_SCHEMA_VERSION).toBe(20);
  });
});
