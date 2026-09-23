import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";

describe("Trilha 05 — bootstrap administrativo",()=>{
 const service=readFileSync("server/services/AdminGovernanceService.ts","utf8");
 const migration=readFileSync("supabase/migrations/20260922200604_trilha05_admin_governance.sql","utf8");
 it("fecha por existência de Super Admin e usa lock transacional",()=>{
  expect(service).toContain("pg_advisory_xact_lock");
  expect(service).toContain("platform_super_admin");
  expect(service).toContain("already_closed");
 });
 it("exige e-mail autorizado apenas no servidor",()=>{
  expect(service).toContain("BOOTSTRAP_ADMIN_EMAIL");
  expect(service).toContain("email_not_authorized");
  expect(migration).not.toContain("BOOTSTRAP_ADMIN_EMAIL");
 });
 it("normaliza formatação acidental e expõe somente dica mascarada",()=>{
  expect(service).toContain("normalizeBootstrapAdminEmail");
  expect(service).toContain("BOOTSTRAP_ADMIN_EMAIL\\s*=\\s*");
  expect(service).toContain("\\u200B-\\u200D\\u2060\\uFEFF");
  expect(service).toContain("normalized.startsWith");
  expect(service).toContain("authorizedEmailHint: maskEmail(authorizedEmail)");
  expect(service).not.toContain("authorizedEmail: authorizedEmail");
 });
});
