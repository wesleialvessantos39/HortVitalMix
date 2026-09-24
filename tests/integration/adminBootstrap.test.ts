import { existsSync, readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";

describe("Trilha 05 — bootstrap administrativo",()=>{
 const service=readFileSync("server/services/AdminGovernanceService.ts","utf8");
 const migration=readFileSync("supabase/migrations/20260922200604_trilha05_admin_governance.sql","utf8");
 const bootstrapRpc=readFileSync("supabase/migrations/20260923194253_trilha05_bootstrap_rpc_finalize.sql","utf8");
 const principalMigration=readFileSync("supabase/migrations/20260924023000_trilha05_admin_principals.sql","utf8");
 const page=readFileSync("src/pages/admin/AdminBootstrapPage.tsx","utf8");
 const transport=readFileSync("src/lib/adminBootstrapTransport.ts","utf8");
 const edge=readFileSync("supabase/functions/admin-bootstrap/index.ts","utf8");
 const apiClient=readFileSync("src/lib/api.ts","utf8");
 const originProtection=readFileSync("server/security/originProtection.ts","utf8");
 const vercel=readFileSync("vercel.json","utf8");
 const vite=readFileSync("vite.config.ts","utf8");
 const runtime=readFileSync("server/config/runtime.ts","utf8");
 it("fecha por existência de Super Admin e usa lock transacional no Supabase",()=>{
  expect(service).toContain('rpc(');
  expect(service).toContain('"fn_finalize_first_super_admin"');
  expect(bootstrapRpc).toContain("pg_advisory_xact_lock");
  expect(bootstrapRpc).toContain("platform_super_admin");
  expect(bootstrapRpc).toContain("already_closed");
 });
 it("resolve a identidade autorizada no Supabase e valida no servidor",()=>{
  expect(service).toContain("CANONICAL_BOOTSTRAP_EMAIL_SHA256");
  expect(service).toContain("resolveBootstrapAuthorizedEmailFromSupabase");
  expect(service).toContain('.from("app_global_config")');
  expect(service).toContain("activeSuperAdminViaDataApi");
  expect(service).toContain("support_email");
  expect(service).toContain("isCanonicalBootstrapAdminEmail");
  expect(service).toContain("timingSafeEqual");
  expect(service).toContain("email_not_authorized");
  expect(bootstrapRpc).toContain("GRANT EXECUTE ON FUNCTION public.fn_finalize_first_super_admin");
  expect(bootstrapRpc).toContain("TO service_role");
  expect(migration).not.toContain("BOOTSTRAP_ADMIN_EMAIL");
 });
 it("corrige preflight CORS e evita rotas Vercel dinâmicas sobrepostas",()=>{
  expect(edge).toContain("status === 204 ? null");
  expect(edge).toContain("x-hvm-request");
  expect(apiClient).toContain('"X-HVM-Request": "1"');
  expect(originProtection).toContain('req.headers["x-hvm-request"] === "1"');
  expect(existsSync("api/v1/[...path].ts")).toBe(false);
  expect(existsSync("api/v1/admin/[...path].ts")).toBe(false);
  expect(existsSync("api/v1/admin/index.ts")).toBe(false);
  expect(vercel).not.toContain('"api/v1/[...path].ts"');
  expect(vercel).not.toContain('"api/v1/admin/[...path].ts"');
 });
 it("possui entrypoints exatos na Vercel e monta API também no preview do Studio",()=>{
  expect(existsSync("api/v1/admin/bootstrap/index.ts")).toBe(true);
  expect(existsSync("api/v1/admin/bootstrap/status.ts")).toBe(true);
  expect(vercel).toContain('"api/v1/admin/bootstrap/index.ts"');
  expect(vercel).toContain('"api/v1/admin/bootstrap/status.ts"');
  expect(vite).toContain("configurePreviewServer");
  expect(vite).toContain('server.middlewares.use("/_hvm_api", app)');
  expect(runtime).toContain("SUPABASE_SECRET_KEY");
  expect(runtime).toContain("SUPABASE_SECRET_KEYS");
  expect(runtime).toContain("SUPABASE_PUBLISHABLE_KEY");
 });
 it("usa Edge apenas como fallback de leitura e mantém a escrita no backend canônico",()=>{
  expect(transport).toContain("/functions/v1/admin-bootstrap");
  expect(transport).toContain("getBootstrapStatus");
  expect(transport).toContain("runBootstrap");
  expect(transport).not.toContain('edgeRequest("POST"');
  expect(page).toContain("getBootstrapStatus");
  expect(page).toContain("runBootstrap");
  expect(edge).toContain("fn_finalize_first_super_admin");
  expect(edge).toContain("BOOTSTRAP_EMAIL_NOT_AUTHORIZED");
  expect(edge).toContain("CANONICAL_EMAIL_SHA256");
 });
 it("permite primeiro Super administrador com CPF público existente sem duplicar app_people",()=>{
  expect(principalMigration).toContain("CREATE TABLE public.app_admin_principals");
  expect(principalMigration).toContain("linkedExistingPerson");
  expect(principalMigration).toContain("v_person_id");
  expect(principalMigration).toContain("app_admin_principals");
  expect(service).not.toContain('cpfConflict');
  expect(edge).not.toContain('cpfConflict');
 });
 it("reutiliza os componentes canônicos de CPF e celular",()=>{
  expect(page).toContain("<CPFInput");
  expect(page).toContain("<PhoneInput");
  expect(page).toContain("BootstrapRequestSchema.safeParse");
  expect(page).not.toContain("Bootstrap liberado neste ambiente");
  expect(page).not.toContain("O servidor está esperando");
 });
 it("normaliza o e-mail e mantém a variável apenas como verificação de consistência",()=>{
  expect(service).toContain("normalizeBootstrapAdminEmail");
  expect(service).toContain("BOOTSTRAP_ADMIN_EMAIL\\s*=\\s*");
  expect(service).toContain("\\u200B-\\u200D\\u2060\\uFEFF");
  expect(service).toContain("normalized.startsWith");
  expect(service).toContain("normalizeBootstrapAdminEmail(input.email)");
  expect(service).toContain("persistido no Supabase; a política do banco prevalecerá");
  expect(service).not.toContain("authorizedEmail: authorizedEmail");
 });
});
