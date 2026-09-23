import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260922200604_trilha05_admin_governance.sql");
const bootstrapRpc = read("supabase/migrations/20260923194253_trilha05_bootstrap_rpc_finalize.sql");
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
  readinessSchema21:
    foundation.includes("FOUNDATION_SCHEMA_VERSION = 21"),
  remoteMigrationAlias:
    migrationManifest.includes('"20260923022554": "20260923022000"'),
  adminScreenDiscovery:
    account.includes("admin-bootstrap-discovery") &&
    account.includes('navigate("/admin/bootstrap")') &&
    account.includes("Verificar configuração inicial") &&
    router.includes("intendedRole={intendedRole}") &&
    read("src/pages/admin/AdminLoginPage.tsx").includes("intendedRole"),
  publicRegistrationDiscovery:
    account.includes("access-discovery") &&
    account.includes('navigate("/cadastro")'),
  bootstrapDiagnostics: (() => {
    const bootstrapPage = read("src/pages/admin/AdminBootstrapPage.tsx");
    return (
      !bootstrapPage.includes("Bootstrap liberado neste ambiente") &&
      !bootstrapPage.includes("O servidor está esperando") &&
      bootstrapPage.includes("O e-mail informado não foi reconhecido") &&
      bootstrapPage.includes("Já existe uma identidade usando este e-mail ou CPF") &&
      bootstrapPage.includes("backend não conseguiu acessar uma dependência obrigatória") &&
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
      originProtection.includes('fetchSite === "same-origin"')
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
