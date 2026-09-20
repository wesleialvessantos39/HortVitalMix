import { dbPool } from "../db/pool.ts";
import { supabaseAdmin, supabasePublic } from "../supabase/client.ts";
import {
  classifyDbError,
  reportFailure,
} from "../config/reportFailure.ts";
import type { PoolClient } from "pg";
import type { Registration } from "../../shared/contracts/auth.ts";

async function compensateIncompleteIdentity(
  userId: string,
  requestId: string,
  client: PoolClient,
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
  emailRedirectTo?: string,
) {
  if (!dbPool)
    throw Object.assign(new Error("REGISTRATION_DATABASE_UNAVAILABLE"), {
      status: 503,
    });
  if (!supabaseAdmin)
    throw Object.assign(new Error("REGISTRATION_AUTH_UNAVAILABLE"), {
      status: 503,
    });

  // Adquire a conexão antes de criar a identidade para não deixar usuário órfão
  // caso o Postgres esteja indisponível.
  let client: PoolClient;
  try {
    client = await dbPool.connect();
  } catch (error) {
    reportFailure({
      category: "registration_database_connect_failed",
      requestId,
      detail: (error as { code?: string })?.code ?? "unknown",
    });
    throw Object.assign(new Error("REGISTRATION_DATABASE_UNAVAILABLE"), {
      status: 503,
    });
  }

  let userId: string | undefined;

  try {
    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: false,
    });

    if (created.error || !created.data.user) {
      const status = created.error?.status;
      const code =
        status === 422
          ? "REGISTRATION_IDENTITY_CONFLICT"
          : status === 429
            ? "REGISTRATION_RATE_LIMITED"
            : "REGISTRATION_AUTH_UNAVAILABLE";

      reportFailure({
        category: "registration_auth_failed",
        requestId,
        detail: created.error?.code ?? String(status ?? "unknown"),
      });

      throw Object.assign(new Error(code), {
        status: status === 422 ? 409 : status === 429 ? 429 : 503,
      });
    }

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
        "INSERT INTO public.app_producer_profiles(person_id,property_name,rural_activity_type,verification_status,trust_level) VALUES($1,$2,$3,'declared',0)",
        [person.rows[0].id, data.propertyName, data.activityType],
      );

    await client.query("COMMIT");

    let confirmationDispatchAccepted = false;
    if (supabasePublic) {
      const { error } = await supabasePublic.auth.resend({
        type: "signup",
        email: data.email,
        options: emailRedirectTo ? { emailRedirectTo } : undefined,
      });
      confirmationDispatchAccepted = !error;
      if (error) reportFailure("confirmation_dispatch_failed", requestId);
    } else {
      reportFailure("confirmation_dispatch_unavailable", requestId);
    }

    return {
      userId,
      confirmationRequired: true,
      confirmationDispatchAccepted,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);

    if (userId) {
      await compensateIncompleteIdentity(userId, requestId, client);
    }

    const message = (error as Error)?.message;
    if (
      message === "REGISTRATION_IDENTITY_CONFLICT" ||
      message === "REGISTRATION_RATE_LIMITED" ||
      message === "REGISTRATION_AUTH_UNAVAILABLE" ||
      message === "REGISTRATION_DATABASE_UNAVAILABLE"
    )
      throw error;

    const dbKind = classifyDbError(error);
    if (dbKind === "conflict")
      throw Object.assign(new Error("REGISTRATION_IDENTITY_CONFLICT"), {
        status: 409,
      });

    reportFailure({
      category: "registration_database_write_failed",
      requestId,
      detail: (error as { code?: string })?.code ?? dbKind,
    });
    throw Object.assign(new Error("REGISTRATION_DATABASE_UNAVAILABLE"), {
      status: 503,
    });
  } finally {
    client.release();
  }
}
