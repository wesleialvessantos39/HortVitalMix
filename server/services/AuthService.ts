import { supabaseAdmin, supabasePublic } from "../supabase/client.ts";
import { reportFailure } from "../config/reportFailure.ts";
import type { Registration } from "../../shared/contracts/auth.ts";

type RegistrationFailure = Error & { status?: number };
type ChainState = "complete" | "incomplete" | "unknown";

function registrationError(code: string, status: number): RegistrationFailure {
  return Object.assign(new Error(code), { status });
}

async function registrationChainState(
  userId: string,
  role: "consumer" | "producer",
  requestId: string,
): Promise<ChainState> {
  if (!supabaseAdmin) return "unknown";
  const admin = supabaseAdmin as any;

  try {
    const person = await admin
      .from("app_people")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (person.error) {
      reportFailure({
        category: "registration_reconcile_people_failed",
        requestId,
        detail: person.error.code ?? "unknown",
      });
      return "unknown";
    }

    const assignment = await admin
      .from("app_user_role_assignments")
      .select("id")
      .eq("user_id", userId)
      .eq("role_code", role)
      .is("revoked_at", null)
      .maybeSingle();

    if (assignment.error) {
      reportFailure({
        category: "registration_reconcile_role_failed",
        requestId,
        detail: assignment.error.code ?? "unknown",
      });
      return "unknown";
    }

    if (!person.data || !assignment.data) return "incomplete";

    if (role === "producer") {
      const profile = await admin
        .from("app_producer_profiles")
        .select("id")
        .eq("person_id", person.data.id)
        .maybeSingle();

      if (profile.error) {
        reportFailure({
          category: "registration_reconcile_producer_failed",
          requestId,
          detail: profile.error.code ?? "unknown",
        });
        return "unknown";
      }

      if (!profile.data) return "incomplete";
    }

    return "complete";
  } catch (error) {
    reportFailure({
      category: "registration_reconcile_transport_failed",
      requestId,
      detail: (error as { name?: string })?.name ?? "unknown",
    });
    return "unknown";
  }
}

async function cleanupIncompleteDomain(userId: string, requestId: string) {
  if (!supabaseAdmin) return;
  const admin = supabaseAdmin as any;

  try {
    const person = await admin
      .from("app_people")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (person.error)
      reportFailure({
        category: "registration_cleanup_person_lookup_failed",
        requestId,
        detail: person.error.code ?? "unknown",
      });

    if (person.data?.id) {
      const producer = await admin
        .from("app_producer_profiles")
        .delete()
        .eq("person_id", person.data.id);

      if (producer.error)
        reportFailure({
          category: "registration_cleanup_producer_failed",
          requestId,
          detail: producer.error.code ?? "unknown",
        });
    }

    const roles = await admin
      .from("app_user_role_assignments")
      .delete()
      .eq("user_id", userId);

    if (roles.error)
      reportFailure({
        category: "registration_cleanup_roles_failed",
        requestId,
        detail: roles.error.code ?? "unknown",
      });

    const people = await admin
      .from("app_people")
      .delete()
      .eq("user_id", userId);

    if (people.error)
      reportFailure({
        category: "registration_cleanup_people_failed",
        requestId,
        detail: people.error.code ?? "unknown",
      });
  } catch (error) {
    reportFailure({
      category: "registration_cleanup_transport_failed",
      requestId,
      detail: (error as { name?: string })?.name ?? "unknown",
    });
  }
}

async function compensateIncompleteIdentity(
  userId: string,
  requestId: string,
) {
  if (!supabaseAdmin) return;

  await cleanupIncompleteDomain(userId, requestId);

  const deleted = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (deleted.error && deleted.error.status !== 404)
    reportFailure({
      category: "auth_compensation_failed",
      requestId,
      detail: deleted.error.code ?? String(deleted.error.status ?? "unknown"),
    });

  // app_users é tombstone canônico e deve permanecer suspenso após exclusão do GoTrue.
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

    try {
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
      const message = (error as Error)?.message;
      const knownFailure =
        message === "REGISTRATION_IDENTITY_CONFLICT" ||
        message === "REGISTRATION_AUTH_UNAVAILABLE" ||
        message === "REGISTRATION_DATABASE_UNAVAILABLE" ||
        message === "REGISTRATION_SCHEMA_OUTDATED" ||
        message === "REGISTRATION_DATA_REJECTED";

      if (knownFailure) throw error;

      const state = await registrationChainState(userId, role, requestId);

      if (state === "complete") {
        reportFailure({
          category: "registration_rpc_response_lost_but_reconciled",
          requestId,
          detail: (error as { name?: string })?.name ?? "unknown",
        });
      } else if (state === "incomplete") {
        throw registrationError("REGISTRATION_DATABASE_UNAVAILABLE", 503);
      } else {
        throw registrationError("REGISTRATION_STATUS_UNKNOWN", 503);
      }
    }
  } catch (error) {
    const message = (error as Error)?.message;

    if (userId && message !== "REGISTRATION_STATUS_UNKNOWN")
      await compensateIncompleteIdentity(userId, requestId);

    if (
      message === "REGISTRATION_IDENTITY_CONFLICT" ||
      message === "REGISTRATION_RATE_LIMITED" ||
      message === "REGISTRATION_AUTH_UNAVAILABLE" ||
      message === "REGISTRATION_DATABASE_UNAVAILABLE" ||
      message === "REGISTRATION_SCHEMA_OUTDATED" ||
      message === "REGISTRATION_DATA_REJECTED" ||
      message === "REGISTRATION_STATUS_UNKNOWN"
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
