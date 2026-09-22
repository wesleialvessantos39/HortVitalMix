import { describe, expect, it } from "vitest";
import request from "supertest";
import { dbPool } from "../../server/db/pool";
import { runtime } from "../../server/config/runtime";
import { app } from "../../server/app";

const enabled = runtime.appEnv === "development" && Boolean(runtime.projectRef) &&
  runtime.projectRef !== "xipbsazvymkqqfmfegwu" && Boolean(dbPool);

describe.skipIf(!enabled)("Trilha 03 — identidade canônica real", () => {
  it("hardening está ativo", async () => {
    const row=await dbPool!.query(`SELECT
      to_regprocedure('public.fn_assert_public_role(text)') IS NOT NULL AS guard,
      to_regprocedure('public.fn_check_auth_people_consistency()') IS NOT NULL AS consistency,
      EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='ix_app_people_email_login') AS email_index,
      EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='auth' AND c.relname='users' AND t.tgname='trg_hortivital_auth_user_email_changed' AND NOT t.tgisinternal) AS email_trigger`);
    expect(row.rows[0]).toEqual({ guard:true, consistency:true, email_index:true, email_trigger:true });
  });
  it("guard rejeita papel administrativo", async () => {
    await expect(dbPool!.query("SELECT public.fn_assert_public_role('consumer')")).resolves.toBeTruthy();
    await expect(dbPool!.query("SELECT public.fn_assert_public_role('producer')")).resolves.toBeTruthy();
    await expect(dbPool!.query("SELECT public.fn_assert_public_role('platform_admin')")).rejects.toBeTruthy();
  });
  it("login público bloqueia administrador sem cookie", async () => {
    const r=await request(app).post("/v1/auth/login").set("Origin","http://localhost:3000")
      .send({email:"naoexiste@example.com",password:"SenhaInvalida#2026",portalRole:"platform_admin"});
    expect(r.status).toBe(403); expect(r.body.error).toBe("ADMIN_PORTAL_REQUIRED"); expect(r.headers["set-cookie"]).toBeUndefined();
  });
  it("login administrativo bloqueia papel público", async () => {
    const r=await request(app).post("/v1/auth/admin-login").set("Origin","http://localhost:3000")
      .send({email:"naoexiste@example.com",password:"SenhaInvalida#2026",portalRole:"consumer"});
    expect(r.status).toBe(403); expect(r.body.error).toBe("PUBLIC_PORTAL_REQUIRED"); expect(r.headers["set-cookie"]).toBeUndefined();
  });
});
