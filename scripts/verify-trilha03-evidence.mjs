import { readFileSync } from "node:fs";
const read=(p)=>readFileSync(p,"utf8");
const auth=read("server/routes/authRoutes.ts"), account=read("src/components/Account.tsx"), app=read("src/App.tsx");
const migration=read("supabase/migrations/20260922002647_trilha03_identity_hardening.sql");
const manifest=JSON.parse(read("supabase/manifest.json"));
const checks={
  schemaAtLeast15:manifest.schemaVersion>=15,
  identityMigrationRegistered:manifest.migrations.some((m)=>m.file==="20260922002647_trilha03_identity_hardening.sql"),
  grantsMigrationRegistered:manifest.migrations.some((m)=>m.file==="20260922004505_trilha03_function_grants_hardening.sql"),
  publicRoleGuard:migration.includes("fn_assert_public_role"),
  emailIndex:migration.includes("ix_app_people_email_login"),
  consistency:migration.includes("fn_check_auth_people_consistency"),
  emailTrigger:migration.includes("trg_hortivital_auth_user_email_changed"),
  adminEndpoint:auth.includes('"/admin-login"'),
  publicAdminBlocked:auth.includes("ADMIN_PORTAL_REQUIRED"),
  rateLimit:auth.includes("loginRateLimit"),
  sameSiteLax:auth.includes('sameSite: "lax"'),
  adminFrontend:account.includes('"/v1/auth/admin-login"'),
  cadastroRoute:app.includes('path === "/cadastro"'),
  sessionHook:app.includes("useSession"),
  directLoginSession:account.includes("onSessionAdopt(authenticated)"),
  adminPanel:account.includes('path === "/admin/painel"'),
  adminSelectorFixed:account.includes('path !== "/admin/entrar"'),
  publicCadastroEntry:app.includes('go("/cadastro")'),
};
if(Object.values(checks).some(v=>!v)){console.error(JSON.stringify({status:"failed",checks},null,2));process.exit(1);}
console.log(JSON.stringify({status:"ok",checks},null,2));
