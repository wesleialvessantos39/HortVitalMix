import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Trilha 04/05 — regressão do recovery e MFA administrativos", () => {
  const authRoutes = readFileSync("server/routes/authRoutes.ts", "utf8");
  const roleSecurity = readFileSync(
    "server/services/RoleSecurityService.ts",
    "utf8",
  );
  const resetPage = readFileSync(
    "src/pages/auth/ResetPasswordPage.tsx",
    "utf8",
  );
  const recoveryPage = readFileSync(
    "src/pages/auth/RecoverPasswordPage.tsx",
    "utf8",
  );
  const session = readFileSync("server/middleware/session.ts", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260924125000_auth_recovery_session_revoke.sql",
    "utf8",
  );

  it("não invalida o link anterior antes do novo e-mail ser entregue", () => {
    const issueStart = roleSecurity.indexOf(
      "export async function issueRecoveryChallenge",
    );
    const issueEnd = roleSecurity.indexOf(
      "export async function recoveryRequestCooldown",
    );
    const issueBody = roleSecurity.slice(issueStart, issueEnd);

    expect(issueBody).not.toContain(
      'invalidateActive(userId, "password_recovery", role)',
    );
    expect(authRoutes).toContain("finalizeRecoveryChallenge");
    expect(authRoutes).toContain("await invalidateChallenge(challenge.id)");
    expect(authRoutes.indexOf("resetPasswordForEmail")).toBeLessThan(
      authRoutes.indexOf("finalizeRecoveryChallenge"),
    );
  });

  it("redefine senha por flow digest-only sem depender do fragmento Supabase", () => {
    expect(authRoutes).toContain('"/password/recovery/validate"');
    expect(authRoutes).toContain("resolveRecoveryChallenge");
    expect(resetPage).toContain('"/v1/auth/password/recovery/validate"');
    expect(resetPage).not.toContain("access_token");
    expect(resetPage).not.toContain("refresh_token");
    expect(resetPage).not.toContain('"/v1/auth/import-session"');
  });

  it("revoga sessões por função restrita ao service_role", () => {
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("DELETE FROM auth.sessions");
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.fn_revoke_auth_sessions(uuid) TO service_role",
    );
    expect(authRoutes).toContain('"fn_revoke_auth_sessions"');
  });

  it("bloqueia reenvio imediato no backend e no frontend", () => {
    expect(roleSecurity).toContain("recoveryRequestCooldown");
    expect(recoveryPage).toContain("retryAfterSeconds");
    expect(recoveryPage).toContain("Novo envio disponível em");
  });

  it("reset-password está no fast path público e não depende de cookies antigos", () => {
    expect(session).toContain("request-password-reset|reset-password|magic-link");
  });
});
