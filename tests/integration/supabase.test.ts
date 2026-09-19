import { describe, it, expect, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dbPool } from "../../server/db/pool";
import { runtime } from "../../server/config/runtime";
import { supabaseAdmin } from "../../server/supabase/client";
const enabled = process.env.RUN_SUPABASE_INTEGRATION === "1";
describe.skipIf(!enabled)("Supabase real e JWTs reais", () => {
  it("exige ambiente isolado explícito", () => {
    expect(runtime.appEnv).toBe("development");
    expect(process.env.SUPABASE_TEST_PROJECT_REF).toBe(runtime.projectRef);
    expect(dbPool).not.toBeNull();
    expect(supabaseAdmin).not.toBeNull();
  });
  it("executa assertions SQL com rollback", async () => {
    if (
      runtime.appEnv !== "development" ||
      process.env.SUPABASE_TEST_PROJECT_REF !== runtime.projectRef ||
      !dbPool
    )
      throw new Error("ISOLATED_TEST_ENV_REQUIRED");
    const c = await dbPool.connect();
    try {
      await c.query(readFileSync("supabase/tests/foundation.sql", "utf8"));
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });
  it("GoTrue cria espelho e JWT respeita isolamento", async () => {
    if (
      runtime.appEnv !== "development" ||
      process.env.SUPABASE_TEST_PROJECT_REF !== runtime.projectRef ||
      !dbPool ||
      !supabaseAdmin
    )
      throw new Error("ISOLATED_TEST_ENV_REQUIRED");
    const email = `hvm-${randomUUID()}@example.com`,
      password = randomUUID() + "A!";
    let id: string | undefined;
    try {
      const created = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(created.error).toBeNull();
      id = created.data.user!.id;
      const auth = createClient(runtime.supabaseUrl, runtime.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const login = await auth.auth.signInWithPassword({ email, password });
      expect(login.error).toBeNull();
      const own = await auth.from("app_users").select("id");
      expect(own.error).toBeNull();
      expect(own.data?.map((r) => r.id)).toEqual([id]);
      const update = await auth
        .from("app_users")
        .update({ status: "blocked" })
        .eq("id", id);
      expect(update.error).not.toBeNull();
      const roles = await auth
        .from("app_user_role_assignments")
        .insert({ user_id: id, role_code: "platform_super_admin" });
      expect(roles.error).not.toBeNull();
      await auth.auth.signOut();
    } finally {
      if (id) {
        const deleted = await supabaseAdmin.auth.admin.deleteUser(id);
        expect(deleted.error).toBeNull();
        const tombstone = await dbPool.query(
          "SELECT status FROM public.app_users WHERE id=$1",
          [id],
        );
        expect(tombstone.rows[0]?.status).toBe("suspended");
        await dbPool.query("DELETE FROM public.app_users WHERE id=$1", [id]);
      }
    }
  });
  afterAll(async () => {
    await dbPool?.end();
  });
});
