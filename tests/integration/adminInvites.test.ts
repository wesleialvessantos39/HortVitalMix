import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";

describe("Trilha 05 — convites administrativos",()=>{
 const service=readFileSync("server/services/AdminGovernanceService.ts","utf8");
 const migration=readFileSync("supabase/migrations/20260922200604_trilha05_admin_governance.sql","utf8");
 it("persiste somente digest do token HortiVitalMix",()=>{
  expect(service).toContain('randomBytes(32).toString("hex")');
  expect(service).toContain("sha256(token)");
  expect(migration).toContain("token_digest char(64)");
 });
 it("materializa setores e usa Supabase Auth para entrega",()=>{
  expect(service).toContain("app_admin_invite_sectors");
  expect(service).toContain("inviteUserByEmail");
  expect(service).toContain("signInWithOtp");
  expect(service).toContain("INVITE_TTL_HOURS = 24");
 });
 it("vincula identidade pública a credencial administrativa separada sem duplicar CPF",()=>{
  expect(service).toContain('identityMode: "new" | "existing"');
  expect(service).toContain("target_person_id");
  expect(service).toContain("app_admin_principals");
  expect(service).toContain("preservedPublicIdentity");
  expect(service).toContain("ON CONFLICT (user_id,role_code) DO UPDATE");
  expect(service).toContain("ON CONFLICT (user_id,sector_code) DO UPDATE");
 });
 it("impõe hierarquia ao administrador setorial",()=>{
  expect(service).toContain('actorRole === "platform_admin"');
  expect(service).toContain('input.targetRole !== "platform_admin"');
  expect(service).toContain("!actorSectors.includes(sector)");
 });
});
