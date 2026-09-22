import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";

describe("Trilha 05 — proteção do último Super Admin",()=>{
 const migration=readFileSync("supabase/migrations/20260922200604_trilha05_admin_governance.sql","utf8");
 const routes=readFileSync("server/routes/adminGovernanceRoutes.ts","utf8");
 it("possui helper canônico e bloqueia operação destrutiva",()=>{
  expect(migration).toContain("fn_is_last_active_super_admin");
  expect(routes).toContain("fn_is_last_active_super_admin");
  expect(routes).toContain("LAST_SUPER_ADMIN_PROTECTED");
 });
});
