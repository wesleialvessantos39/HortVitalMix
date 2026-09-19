import { describe, it, expect, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dbPool } from "../../server/db/pool";
import { runtime } from "../../server/config/runtime";
import { supabaseAdmin } from "../../server/supabase/client";

const enabled = process.env.HVM_INTEGRATION_ENABLED === "true";

function assertIsolatedDevelopment() {
  if (runtime.appEnv !== "development") throw new Error("ISOLATED_TEST_ENV_REQUIRED");
  const productionRef = process.env.HVM_PROD_PROJECT_REF;
  if (productionRef && runtime.projectRef === productionRef)
    throw new Error("PRODUCTION_PROJECT_REF_REJECTED");
  if (!dbPool || !supabaseAdmin) throw new Error("INTEGRATION_CLIENTS_REQUIRED");
}

describe.skipIf(!enabled)("Supabase real e JWTs reais", () => {
  it("exige ambiente development isolado", () => {
    assertIsolatedDevelopment();
    expect(dbPool).not.toBeNull();
    expect(supabaseAdmin).not.toBeNull();
  });

  it("executa assertions SQL com rollback", async () => {
    assertIsolatedDevelopment();
    const c = await dbPool!.connect();
    try {
      await c.query(readFileSync("supabase/tests/foundation.sql", "utf8"));
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
  });

  it("GoTrue cria espelho e JWT respeita isolamento", async () => {
    assertIsolatedDevelopment();

    const email = `hvm-${randomUUID()}@example.com`;
    const password = randomUUID() + "A!";
    let id: string | undefined;

    try {
      const created = await supabaseAdmin!.auth.admin.createUser({
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
        const deleted = await supabaseAdmin!.auth.admin.deleteUser(id);
        expect(deleted.error).toBeNull();

        const tombstone = await dbPool!.query(
          "SELECT status FROM public.app_users WHERE id=$1",
          [id],
        );
        expect(tombstone.rows[0]?.status).toBe("suspended");

        await dbPool!.query("DELETE FROM public.app_users WHERE id=$1", [id]);
      }
    }
  });

  afterAll(async () => {
    await dbPool?.end();
  });
});
