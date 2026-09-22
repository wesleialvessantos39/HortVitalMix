import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("Trilha 03 — caminho crítico de autenticação", () => {
  it("login devolve a sessão no próprio POST e o frontend adota essa sessão", () => {
    const routes = read("server/routes/authRoutes.ts");
    const account = read("src/components/Account.tsx");
    expect(routes).toContain("userId: data.user.id");
    expect(routes).toContain("roles: access.roles");
    expect(account).toContain("onSessionAdopt(authenticated)");
    expect(account).not.toContain('setSession(await api<Session>("/v1/auth/session"))');
  });

  it("resolução de acesso consolida status, sessão, papéis e pessoa em uma consulta", () => {
    const service = read("server/services/IdentityAccessService.ts");
    expect(service).toContain("auth.sessions");
    expect(service).toContain("app_user_role_assignments");
    expect(service).toContain("app_people");
    expect(service).toContain("array_agg");
  });

  it("cadastro consulta CPF e e-mail em paralelo e não espera reenvio de confirmação", () => {
    const auth = read("server/services/AuthService.ts");
    const account = read("src/components/Account.tsx");
    expect(auth).toContain("Promise.all([");
    expect(auth).not.toContain("supabasePublic.auth.resend");
    expect(account).toContain('void api("/v1/auth/resend-confirmation"');
  });

  it("admin/entrar não cai no seletor público e o painel administrativo existe", () => {
    const account = read("src/components/Account.tsx");
    expect(account).toContain('path !== "/admin/entrar"');
    expect(account).toContain('path === "/admin/painel"');
    expect(account).toContain("Abrir Configuração Global — Trilha 02");
  });
});


it("oculta a entrada administrativa durante sessão pública ativa", () => {
  const app = read("src/App.tsx");
  const routes = read("server/routes/authRoutes.ts");
  expect(routes).toContain('portalKind: portalKindForRole(portalRole)');
  expect(routes).toContain('"administrative"');
  expect(routes).toContain('"public"');
  expect(app).toContain('shellSession?.portalKind === "public"');
  expect(app).toContain('shellSession?.activeRole === "consumer"');
  expect(app).toContain('shellSession?.activeRole === "producer"');
  expect(app).toContain("const showAdministrationEntry = !publicPortalSession");
  expect(app).toContain("{showAdministrationEntry && (");
});
