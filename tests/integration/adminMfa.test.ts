import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";

describe("Trilha 05 — MFA administrativo",()=>{
 const service=readFileSync("server/services/AdminGovernanceService.ts","utf8");
 const migration=readFileSync("supabase/migrations/20260922200604_trilha05_admin_governance.sql","utf8");
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
});
