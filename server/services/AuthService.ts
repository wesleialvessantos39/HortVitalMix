import { supabaseAdmin, supabasePublic } from "../supabase/client.ts";
import { reportFailure } from "../config/reportFailure.ts";
import type { Registration } from "../../shared/contracts/auth.ts";

type RegistrationFailure = Error & { status?: number };

function registrationError(code: string, status: number): RegistrationFailure {
  return Object.assign(new Error(code), { status });
}

async function compensateIncompleteIdentity(
  userId: string,
  requestId: string,
) {
  if (!supabaseAdmin) return;

  const deleted = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (deleted.error && deleted.error.status !== 404) {
    reportFailure({
      category: "auth_compensation_failed",
      requestId,
      detail: deleted.error.code ?? String(deleted.error.status ?? "unknown"),
    });
    return;
  }

  const cleanup = await supabaseAdmin
    .from("app_users")
    .delete()
    .eq("id", userId)
    .eq("status", "suspended")
    .eq("block_reason", "auth_user_deleted");

  if (cleanup.error)
    reportFailure({
      category: "auth_compensation_tombstone_cleanup_failed",
      requestId,
      detail: cleanup.error.code ?? "unknown",
    });
}

function mapDomainRegistrationError(
  error: { code?: string | null; message?: string | null },
  requestId: string,
): RegistrationFailure {
  const code = error.code ?? "unknown";

  reportFailure({
    category: "registration_domain_rpc_failed",
    requestId,
    detail: code,
  });

  if (code === "23505")
    return registrationError("REGISTRATION_IDENTITY_CONFLICT", 409);

  if (code === "22023")
    return registrationError("REGISTRATION_DATA_REJECTED", 400);

  if (code === "PGRST202" || code === "42883")
    return registrationError("REGISTRATION_SCHEMA_OUTDATED", 503);

  if (code === "42501")
    return registrationError("REGISTRATION_AUTH_UNAVAILABLE", 503);

  return registrationError("REGISTRATION_DATABASE_UNAVAILABLE", 503);
}

export async function register(
  data: Registration,
  role: "consumer" | "producer",
  requestId: string,
  emailRedirectTo?: string,
) {
  if (!supabaseAdmin)
    throw registrationError("REGISTRATION_AUTH_UNAVAILABLE", 503);

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

      throw registrationError(
        code,
        status === 422 ? 409 : status === 429 ? 429 : 503,
      );
    }

    userId = created.data.user.id;

    const completed = await supabaseAdmin.rpc("complete_public_registration", {
      p_user_id: userId,
      p_full_name: data.fullName,
      p_cpf_normalized: data.cpf,
      p_email_normalized: data.email,
      p_phone_e164: data.phone,
      p_role: role,
      p_property_name: role === "producer" ? data.propertyName ?? null : null,
      p_activity_type: role === "producer" ? data.activityType ?? null : null,
    });

    if (completed.error)
      throw mapDomainRegistrationError(completed.error, requestId);
  } catch (error) {
    if (userId) await compensateIncompleteIdentity(userId, requestId);

    const message = (error as Error)?.message;
    if (
      message === "REGISTRATION_IDENTITY_CONFLICT" ||
      message === "REGISTRATION_RATE_LIMITED" ||
      message === "REGISTRATION_AUTH_UNAVAILABLE" ||
      message === "REGISTRATION_DATABASE_UNAVAILABLE" ||
      message === "REGISTRATION_SCHEMA_OUTDATED" ||
      message === "REGISTRATION_DATA_REJECTED"
    )
      throw error;

    reportFailure({
      category: "registration_unexpected_failure",
      requestId,
      detail: (error as { name?: string })?.name ?? "unknown",
    });

    throw registrationError("REGISTRATION_UNEXPECTED_FAILURE", 503);
  }

  let confirmationDispatchAccepted = false;
  if (supabasePublic) {
    try {
      const { error } = await supabasePublic.auth.resend({
        type: "signup",
        email: data.email,
        options: emailRedirectTo ? { emailRedirectTo } : undefined,
      });
      confirmationDispatchAccepted = !error;
      if (error)
        reportFailure({
          category: "confirmation_dispatch_failed",
          requestId,
          detail: error.code ?? String(error.status ?? "unknown"),
        });
    } catch (error) {
      reportFailure({
        category: "confirmation_dispatch_failed",
        requestId,
        detail: (error as { name?: string })?.name ?? "unknown",
      });
    }
  } else {
    reportFailure("confirmation_dispatch_unavailable", requestId);
  }

  return {
    userId,
    confirmationRequired: true,
    confirmationDispatchAccepted,
  };
}
