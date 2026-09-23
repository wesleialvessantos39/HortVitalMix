import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";

describe("Trilha 05 — bootstrap administrativo",()=>{
 const service=readFileSync("server/services/AdminGovernanceService.ts","utf8");
 const migration=readFileSync("supabase/migrations/20260922200604_trilha05_admin_governance.sql","utf8");
 const bootstrapRpc=readFileSync("supabase/migrations/20260923194253_trilha05_bootstrap_rpc_finalize.sql","utf8");
 const page=readFileSync("src/pages/admin/AdminBootstrapPage.tsx","utf8");
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
