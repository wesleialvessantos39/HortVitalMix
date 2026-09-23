import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";

describe("Trilha 05 — fluxo administrativo integrado",()=>{
 const app=readFileSync("src/App.tsx","utf8");
 const router=readFileSync("src/pages/admin/AdminRouter.tsx","utf8");
 const server=readFileSync("server/app.ts","utf8");
 it("liga backend e frontend no mesmo volume",()=>{
  expect(server).toContain("adminGovernanceRouter");
  expect(app).toContain("AdminRouter");
  expect(router).toContain("AdminAccessGate");
  expect(router).toContain("AdminPortalShell");
 });
});
