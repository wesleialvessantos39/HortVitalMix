import { dbPool } from "../db/pool.ts";
import { supabaseAdmin } from "../supabase/client.ts";
import { runtime } from "../config/runtime.ts";
import { reportFailure } from "../config/reportFailure.ts";
import type { Registration } from "../../shared/contracts/auth.ts";

async function compensateIncompleteIdentity(
  userId: string,
  requestId: string,
  client: NonNullable<typeof dbPool> extends never ? never : any,
) {
  if (!supabaseAdmin) return;

  const deleted = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (deleted.error) {
    reportFailure("auth_compensation_failed", requestId);
    return;
  }

  try {
    await client.query(
      `DELETE FROM public.app_users u
       WHERE u.id=$1
         AND u.status='suspended'
         AND u.block_reason='auth_user_deleted'
         AND NOT EXISTS (
           SELECT 1 FROM public.app_people p WHERE p.user_id=u.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM public.app_user_role_assignments r WHERE r.user_id=u.id
         )`,
      [userId],
    );
  } catch {
    reportFailure("auth_compensation_tombstone_cleanup_failed", requestId);
  }
}

export async function register(
  data: Registration,
  role: "consumer" | "producer",
  requestId: string,
) {
  if (!dbPool || !supabaseAdmin)
    throw Object.assign(new Error("DEPENDENCY_UNAVAILABLE"), { status: 503 });

  // Adquire a conexão antes de criar a identidade para não deixar usuário órfão
  // caso o Postgres esteja indisponível.
  const client = await dbPool.connect();
  let userId: string | undefined;

  try {
    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: runtime.appEnv === "development",
      // Metadado informativo apenas. Autorização real nasce exclusivamente
      // em app_user_role_assignments, nunca de user_metadata.
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

    return {
      userId,
      confirmationRequired: runtime.appEnv !== "development",
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);

    if (userId) {
      await compensateIncompleteIdentity(userId, requestId, client);
    }

    throw error;
  } finally {
    client.release();
  }
}
