import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260922200604_trilha05_admin_governance.sql");
const bootstrapRpc = read("supabase/migrations/20260923194253_trilha05_bootstrap_rpc_finalize.sql");
const adminPrincipalMigration = read("supabase/migrations/20260924023000_trilha05_admin_principals.sql");
const adminEmailVerificationMigration = read("supabase/migrations/20260924114500_trilha05_admin_email_verification.sql");
const recoverySessionMigration = read("supabase/migrations/20260924125000_auth_recovery_session_revoke.sql");
const roleScopedCredentialsMigration = read("supabase/migrations/20260924165427_admin_role_scoped_credentials.sql");
const service = read("server/services/AdminGovernanceService.ts");
const routes = read("server/routes/adminGovernanceRoutes.ts");
const middleware = read("server/middleware/adminSession.ts");
const app = read("src/App.tsx");
const router = read("src/pages/admin/AdminRouter.tsx");
const css = read("src/pages/admin/admin.css");
const env = read(".env.example");
const legacyAuth = read("server/routes/authRoutes.ts");
const account = read("src/components/Account.tsx");
const foundation = read("shared/contracts/foundation.ts");
const migrationManifest = read("scripts/migrations-manifest.ts");
const apiClient = read("src/lib/api.ts");
const originProtection = read("server/security/originProtection.ts");
const bootstrapTransport = read("src/lib/adminBootstrapTransport.ts");
const bootstrapEdge = read("supabase/functions/admin-bootstrap/index.ts");
const vercelConfig = read("vercel.json");
const viteConfig = read("vite.config.ts");
const runtimeConfig = read("server/config/runtime.ts");

function bootstrapPageDoesNotExposeTechnicalDetails() {
  const bootstrapPage = read("src/pages/admin/AdminBootstrapPage.tsx");
  const accountPage = read("src/components/Account.tsx");
  return (
    bootstrapPage.includes("Cadastro não autorizado.") &&
    !accountPage.includes("Falha não identificada no cadastro:") &&
    !accountPage.includes("Código de atendimento:")
  );
}

const requiredTables = [
  "app_admin_sectors",
  "app_admin_sector_members",
  "app_admin_invites",
  "app_admin_invite_sectors",
  "app_admin_mfa_challenges",
  "app_admin_auth_attempts",
];

const checks = {
  sixTables: requiredTables.every((name) =>
    migration.includes(`CREATE TABLE public.${name}`),
  ),
  forcedRls: (migration.match(/FORCE ROW LEVEL SECURITY/g) ?? []).length === 6,
  canonicalSectors: [
    "document_verification",
    "catalog_moderation",
    "finance_ops",
  ].every((code) => migration.includes(code)),
  bootstrapGuard:
    bootstrapRpc.includes("pg_advisory_xact_lock") &&
    bootstrapRpc.includes("fn_finalize_first_super_admin") &&
    bootstrapRpc.includes("TO service_role") &&
    service.includes('"fn_finalize_first_super_admin"') &&
    service.includes("CANONICAL_BOOTSTRAP_EMAIL_SHA256") &&
    service.includes("resolveBootstrapAuthorizedEmailFromSupabase") &&
    service.includes('.from("app_global_config")') &&
    service.includes("activeSuperAdminViaDataApi") &&
    service.includes("support_email") &&
    service.includes("isCanonicalBootstrapAdminEmail") &&
    service.includes("timingSafeEqual") &&
    env.includes("BOOTSTRAP_ADMIN_EMAIL="),
  superAdminMfa:
    service.includes("signInWithOtp") &&
    service.includes("verifyOtp") &&
    service.includes('status: "mfa_required"'),
  supabaseOnlyDelivery:
    service.includes("inviteUserByEmail") &&
    !service.includes("Resend") &&
    !service.includes("Twilio") &&
    !service.includes("GMAIL_"),
  inviteDigest:
    service.includes('randomBytes(32).toString("hex")') &&
    service.includes("pg_advisory_xact_lock") &&
    service.includes("FOR UPDATE") &&
    service.includes("sha256(token)") &&
    migration.includes("token_digest char(64)"),
  identityMigrationHierarchy:
    service.includes('identityMode: "new" | "existing"') &&
    service.includes("target_person_id") &&
    service.includes("app_admin_principals") &&
    service.includes('actorRole === "platform_admin"') &&
    service.includes('input.targetRole !== "platform_admin"') &&
    routes.includes('"/identities/lookup"') &&
    routes.includes("app_admin_principals") &&
    read("src/pages/admin/AdminAcceptInvitePage.tsx").includes("credencial administrativa separada") &&
    read("src/pages/admin/AdminGovernancePage.tsx").includes("CPF já cadastrado (opcional)") &&
    read("src/pages/admin/AdminUsersPage.tsx").includes("Perfis vinculados") &&
    router.includes('const superOnly = path==="/admin/configuracao"') &&
    read("src/components/admin/AdminPortalShell.tsx").includes('return to !== "/admin/configuracao"') &&
    adminPrincipalMigration.includes("CREATE TABLE public.app_admin_principals") &&
    adminPrincipalMigration.includes("linkedExistingPerson"),
  persistentRateLimit:
    service.includes("app_admin_auth_attempts") &&
    service.includes("RATE_MAX_FAILURES = 10") &&
    service.includes("email_failures") &&
    service.includes("ip_failures"),
  sectorInvariant:
    middleware.includes("Administrador Setorial sem setor ativo") &&
    routes.includes('"/sectors"'),
  lastSuperProtection:
    routes.includes("fn_is_last_active_super_admin") &&
    routes.includes("LAST_SUPER_ADMIN_PROTECTED"),
  requiredEndpoints: [
    "/bootstrap/status",
    "/auth/login",
    "/auth/mfa/verify",
    "/auth/email-confirmation/request",
    "/auth/email-confirmation/verify",
    "/auth/verify-session",
    "/invites",
    "/invites/validate",
    "/invites/accept",
    "/sectors",
    "/users",
  ].every((path) => routes.includes(path)),
  canonicalInviteRoute:
    service.includes("/admin/aceitar-convite?token=") &&
    router.includes('path==="/admin/aceitar-convite"'),
  helpDialog:
    read("src/pages/admin/AdminLoginPage.tsx").includes("Como obter acesso administrativo") &&
    css.includes("admin-help-backdrop"),
  frontendFiles: [
    "AdminLoginPage",
    "AdminBootstrapPage",
    "AdminAcceptInvitePage",
    "AdminGovernancePage",
    "AdminDashboardPage",
    "AdminUsersPage",
    "AdminEmailConfirmationPage",
  ].every((name) => router.includes(name)),
  appIntegration:
    app.includes("AdminRouter") && app.includes("admin-route-layout"),
  responsive:
    css.includes("@media (max-width:767px)") &&
    css.includes("@media (min-width:768px) and (max-width:1199px)"),
  brand: css.includes("#1b4d2e") && css.includes("#ef7d18"),
  legacyAdminBypassClosed:
    legacyAuth.includes('authRouter.post("/admin-login"') &&
    legacyAuth.includes('"ADMIN_GOVERNANCE_LOGIN_REQUIRED"') &&
    !account.includes('"/v1/auth/admin-login"'),
  readinessSchema25:
    foundation.includes("FOUNDATION_SCHEMA_VERSION = 25"),
  remoteMigrationAlias:
    migrationManifest.includes('"20260923022554": "20260923022000"') &&
    migrationManifest.includes('"20260924023250": "20260924023000"') &&
    migrationManifest.includes('"20260924115207": "20260924114500"') &&
    migrationManifest.includes('"20260924124802": "20260924125000"'),
  adminScreenDiscovery:
    account.includes("admin-bootstrap-discovery") &&
    account.includes('navigate("/admin/bootstrap")') &&
    account.includes("Verificar configuração inicial") &&
    router.includes("intendedRole={intendedRole}") &&
    router.includes('path==="/acesso/administracao"') &&
    router.includes('path==="/acesso/super-administracao"') &&
    read("src/pages/admin/AdminLoginPage.tsx").includes("intendedRole"),
  friendlyAdminErrors:
    read("src/pages/admin/AdminLoginPage.tsx").includes("Dados inválidos ou cadastro não autorizado.") &&
    bootstrapPageDoesNotExposeTechnicalDetails(),
  adminSecurityUx:
    read("src/pages/admin/AdminLoginPage.tsx").includes("<PasswordInput") &&
    read("src/pages/admin/AdminLoginPage.tsx").includes("Esqueci minha senha") &&
    read("src/pages/admin/AdminLoginPage.tsx").includes("Reenviar código de segurança") &&
    read("src/pages/admin/AdminLoginPage.tsx").includes("Confirmar ou reenviar confirmação do e-mail") &&
    read("src/pages/admin/AdminEmailConfirmationPage.tsx").includes("<OtpInput") &&
    read("src/pages/admin/AdminEmailConfirmationPage.tsx").includes("Enviar código de confirmação") &&
    router.includes('path==="/admin/confirmar-email"'),
  adminServerlessAuth:
    service.includes('.from("app_admin_auth_attempts")') &&
    service.includes('.from("app_admin_mfa_challenges")') &&
    read("server/services/RoleSecurityService.ts").includes("app_admin_principals") &&
    read("server/services/IdentityAccessService.ts").includes("resolveViaDataApi") &&
    legacyAuth.includes('"fn_revoke_auth_sessions"') &&
    recoverySessionMigration.includes("DELETE FROM auth.sessions") &&
    recoverySessionMigration.includes("TO service_role"),
  adminMailCooldown:
    service.includes("authEmailRetryAfter") &&
    service.includes('status: "email_rate_limited"') &&
    service.includes('status: "cooldown"') &&
    read("src/pages/admin/AdminLoginPage.tsx").includes("mailCooldown") &&
    read("src/pages/admin/AdminEmailConfirmationPage.tsx").includes("retryAfter"),
  recoveryRootCauseClosed:
    legacyAuth.includes("recoveryRequestCooldown") &&
    legacyAuth.includes("finalizeRecoveryChallenge") &&
    legacyAuth.includes('"/password/recovery/validate"') &&
    legacyAuth.includes("resolveRecoveryChallenge") &&
    legacyAuth.includes('"fn_revoke_auth_sessions"') &&
    read("src/pages/auth/ResetPasswordPage.tsx").includes('"/v1/auth/password/recovery/validate"') &&
    !read("src/pages/auth/ResetPasswordPage.tsx").includes('"/v1/auth/import-session"'),
  adminEmailOwnership:
    adminEmailVerificationMigration.includes("email_verified_at") &&
    service.includes("requestAdminEmailConfirmation") &&
    service.includes("verifyAdminEmailConfirmation") &&
    service.includes('status: "email_confirmation_required"') &&
    service.includes("(admin_user_id,person_id,admin_email,portal_role,auth_email,created_by,email_verified_at)") &&
    roleScopedCredentialsMigration.includes("uq_app_admin_principals_person_role") &&
    roleScopedCredentialsMigration.includes("uq_app_admin_principals_email_role") &&
    roleScopedCredentialsMigration.includes("auth_email"),
  publicRegistrationDiscovery:
    account.includes("access-discovery") &&
    account.includes('navigate("/cadastro")'),
  bootstrapDiagnostics: (() => {
    const bootstrapPage = read("src/pages/admin/AdminBootstrapPage.tsx");
    return (
      !bootstrapPage.includes("Bootstrap liberado neste ambiente") &&
      !bootstrapPage.includes("O servidor está esperando") &&
      bootstrapPage.includes("O e-mail informado não foi reconhecido") &&
      bootstrapPage.includes("Cadastro não autorizado. Os dados informados já estão vinculados a outra conta.") &&
      bootstrapPage.includes("Não foi possível concluir a configuração inicial agora") &&
      bootstrapPage.includes("<CPFInput") &&
      bootstrapPage.includes("<PhoneInput") &&
      bootstrapPage.includes("BootstrapRequestSchema.safeParse") &&
      service.includes("normalizeBootstrapAdminEmail(input.email)") &&
      service.includes("resolveBootstrapAuthorizedEmailFromSupabase") &&
      service.includes("persistido no Supabase; a política do banco prevalecerá") &&
      service.includes("CANONICAL_BOOTSTRAP_EMAIL_SHA256") &&
      service.includes('"fn_finalize_first_super_admin"') &&
      bootstrapRpc.includes("GRANT EXECUTE ON FUNCTION public.fn_finalize_first_super_admin") &&
      bootstrapPage.includes('status:"open" as const') &&
      routes.includes("BOOTSTRAP_EMAIL_NOT_AUTHORIZED") &&
      apiClient.includes('hostname.endsWith(".vercel.app")') &&
      apiClient.includes('["/_hvm_api", "/api"]') &&
      originProtection.includes('fetchSite === "same-origin"') &&
      bootstrapTransport.includes("/functions/v1/admin-bootstrap") &&
      bootstrapTransport.includes("getBootstrapStatus") &&
      bootstrapTransport.includes("runBootstrap") &&
      !bootstrapTransport.includes('edgeRequest("POST"') &&
      bootstrapEdge.includes("fn_finalize_first_super_admin") &&
      bootstrapEdge.includes("CANONICAL_EMAIL_SHA256") &&
      bootstrapEdge.includes("status === 204 ? null") &&
      apiClient.includes('"X-HVM-Request": "1"') &&
      originProtection.includes('req.headers["x-hvm-request"] === "1"') &&
      !existsSync("api/v1/[...path].ts") &&
      !existsSync("api/v1/admin/[...path].ts") &&
      !existsSync("api/v1/admin/index.ts") &&
      existsSync("api/v1/admin/bootstrap/index.ts") &&
      existsSync("api/v1/admin/bootstrap/status.ts") &&
      !vercelConfig.includes('"api/v1/[...path].ts"') &&
      !vercelConfig.includes('"api/v1/admin/[...path].ts"') &&
      vercelConfig.includes('"api/v1/admin/bootstrap/index.ts"') &&
      vercelConfig.includes('"api/v1/admin/bootstrap/status.ts"') &&
      viteConfig.includes("configurePreviewServer") &&
      runtimeConfig.includes("SUPABASE_SECRET_KEY") &&
      runtimeConfig.includes("SUPABASE_SECRET_KEYS") &&
      runtimeConfig.includes("SUPABASE_PUBLISHABLE_KEY")
    );
  })(),
};

const failed = Object.entries(checks)
  .filter(([, ok]) => !ok)
  .map(([name]) => name);

if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, checks }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checks }, null, 2));
