import { dbPool } from "../db/pool.ts";
import { supabaseAdmin } from "../supabase/client.ts";
import { runtime } from "../config/runtime.ts";
import { reportFailure } from "../config/reportFailure.ts";
import type { Registration } from "../../shared/contracts/auth.ts";
export async function register(
  data: Registration,
  role: "consumer" | "producer",
  requestId: string,
) {
  if (!dbPool || !supabaseAdmin)
    throw Object.assign(new Error("DEPENDENCY_UNAVAILABLE"), { status: 503 });
  // Acquire before GoTrue creation so a failed connection cannot strand an identity.
  const client = await dbPool.connect();
  let userId: string | undefined;
  try {
    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: runtime.appEnv === "development",
      user_metadata: { intended_role: role },
    });
    if (created.error || !created.data.user)
      throw Object.assign(new Error("REGISTRATION_NOT_COMPLETED"), {
        status: created.error?.status === 422 ? 409 : 503,
      });
    userId = created.data.user.id;
    await client.query("BEGIN");
    const person = await client.query(
      "INSERT INTO public.app_people(user_id,full_name,cpf_normalized,email_normalized,phone_e164) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [userId, data.fullName, data.cpf, data.email, data.phone],
    );
    await client.query(
      "INSERT INTO public.app_user_role_assignments(user_id,role_code) VALUES($1,$2)",
      [userId, role],
    );
    if (role === "producer")
      await client.query(
        "INSERT INTO public.app_producer_profiles(person_id,brand_name,rural_activity_type,verification_status,trust_level) VALUES($1,$2,$3,'declared',0)",
        [person.rows[0].id, data.brandName, data.activityType],
      );
    await client.query("COMMIT");
    return { userId, confirmationRequired: runtime.appEnv !== "development" };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (userId) {
      const result = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (result.error) reportFailure("auth_compensation_failed", requestId);
    }
    throw error;
  } finally {
    client.release();
  }
}
