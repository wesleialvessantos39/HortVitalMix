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
  expect(service).toContain("INVITE_TTL_HOURS = 24");
 });
});
