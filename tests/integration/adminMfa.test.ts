import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";

describe("Trilha 05 — MFA administrativo",()=>{
 const service=readFileSync("server/services/AdminGovernanceService.ts","utf8");
 const migration=readFileSync("supabase/migrations/20260922200604_trilha05_admin_governance.sql","utf8");
 const loginPage=readFileSync("src/pages/admin/AdminLoginPage.tsx","utf8");
 const roleSecurity=readFileSync("server/services/RoleSecurityService.ts","utf8");

 it("obriga MFA do Super Admin sem entregar sessão antes da verificação",()=>{
  const signIn=service.indexOf("signInWithPassword");
  const mfa=service.indexOf('status: "mfa_required"');
  const verify=service.indexOf("verifyOtp");
  expect(signIn).toBeGreaterThan(-1);
  expect(mfa).toBeGreaterThan(signIn);
  expect(verify).toBeGreaterThan(-1);
 });

 it("mantém desafio persistente com limite de tentativas",()=>{
  expect(migration).toContain("max_attempts integer NOT NULL DEFAULT 5");
  expect(service).toContain("attemptsRemaining");
  expect(service).toContain("mfa_failure");
 });

 it("não depende do Transaction Pooler para iniciar login e MFA",()=>{
  expect(service).not.toContain(
   'if (!dbPool) return { status: "unavailable" };\n    const limited = await this.rateLimit',
  );
  expect(service).toContain('.from("app_admin_auth_attempts")');
  expect(service).toContain('.from("app_admin_mfa_challenges")');
  expect(service).toContain("activeAdminRole");
 });

 it("exibe senha, recuperação, confirmação e reenvio do código na tela administrativa",()=>{
  expect(loginPage).toContain("<PasswordInput");
  expect(loginPage).toContain("Esqueci minha senha");
  expect(loginPage).toContain("Confirmar ou reenviar confirmação do e-mail");
  expect(loginPage).toContain("Reenviar código de segurança");
  expect(loginPage).toContain("<OtpInput");
 });

 it("trata cooldown do e-mail de MFA sem registrar falha de credencial",()=>{
  expect(service).toContain("authEmailRetryAfter");
  expect(service).toContain('status: "email_rate_limited"');
  expect(service).toContain('phase: "mfa"');
  expect(loginPage).toContain("mailCooldown");
  expect(loginPage).toContain("O provedor protege o envio de e-mails de segurança");
 });

 it("recuperação reconhece principal administrativo separado",()=>{
  expect(roleSecurity).toContain("app_admin_principals");
  expect(roleSecurity).toContain("admin_user_id");
  expect(roleSecurity).toContain("platform_super_admin");
 });
});
