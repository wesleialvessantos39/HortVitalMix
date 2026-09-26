import {
  createSupabasePublicClient,
  supabaseAdmin,
} from "../supabase/client.ts";
import { reportFailure } from "../config/reportFailure.ts";
import type { Registration } from "../../shared/contracts/auth.ts";

type RegistrationFailure = Error & { status?: number };
type ChainState = "complete" | "incomplete" | "unknown";

const CANONICAL_PUBLIC_REGISTRATION_EDGE =
  "https://xipbsazvymkqqfmfegwu.supabase.co/functions/v1/public-registration";

function edgeRegistrationError(
  code: string,
  status: number,
): RegistrationFailure {
  const mapped =
    code === "IDENTITY_CONFLICT"
      ? "REGISTRATION_IDENTITY_CONFLICT"
      : code === "ROLE_ALREADY_ASSIGNED"
        ? "REGISTRATION_ROLE_ALREADY_ASSIGNED"
        : code === "CPF_LINKED_TO_EXISTING_ACCOUNT"
          ? "REGISTRATION_CPF_LINKED_TO_EXISTING_ACCOUNT"
          : code === "EXISTING_ACCOUNT_CREDENTIALS_INVALID"
            ? "REGISTRATION_EXISTING_ACCOUNT_CREDENTIALS_INVALID"
            : code === "EXISTING_ACCOUNT_CONFIRM_REQUIRED"
              ? "REGISTRATION_EXISTING_ACCOUNT_CONFIRM_REQUIRED"
              : code === "AUTH_UNAVAILABLE"
                ? "REGISTRATION_AUTH_UNAVAILABLE"
                : code === "DATABASE_UNAVAILABLE"
                  ? "REGISTRATION_DATABASE_UNAVAILABLE"
                  : code === "VALIDATION_ERROR"
                    ? "REGISTRATION_DATA_REJECTED"
                    : code.startsWith("REGISTRATION_")
                      ? code
                      : "REGISTRATION_UNEXPECTED_FAILURE";
  return registrationError(mapped, status || 503);
}

async function registerThroughEdge(
  data: Registration,
  role: "consumer" | "producer",
  requestId: string,
) {
  let response: Response;
  try {
    response = await fetch(CANONICAL_PUBLIC_REGISTRATION_EDGE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-HVM-Request": "1",
        "X-Request-Id": requestId,
      },
      body: JSON.stringify({ role, data }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    reportFailure({
      category: "registration_edge_transport_failed",
      requestId,
      detail: (error as { name?: string })?.name ?? "unknown",
    });
    throw registrationError("REGISTRATION_AUTH_UNAVAILABLE", 503);
  }

  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    const code = String(body.error ?? `HTTP_${response.status}`);
    reportFailure({
      category: "registration_edge_failed",
      requestId,
      detail: code,
    });
    throw edgeRegistrationError(code, response.status);
  }

  return {
    userId: typeof body.userId === "string" ? body.userId : undefined,
    confirmationRequired: Boolean(body.confirmationRequired),
    confirmationDispatchAccepted: Boolean(
      body.confirmationDispatchAccepted,
    ),
    confirmationDispatchDeferred: Boolean(
      body.confirmationDispatchDeferred,
    ),
    existingIdentity: Boolean(body.existingIdentity),
    roleAdded: body.roleAdded !== false,
    role,
    transport: "supabase_edge" as const,
  };
}

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

type ExistingPerson = {
  id: string;
  user_id: string;
  cpf_normalized: string;
  email_normalized: string;
};

async function findExistingPerson(
  data: Registration,
  requestId: string,
): Promise<ExistingPerson | null> {
  if (!supabaseAdmin) return null;
  const admin = supabaseAdmin as any;

  // Consulta CPF e e-mail em paralelo no banco de dados
  const [cpfResult, emailResult] = await Promise.all([
    admin.from("app_people").select("id,user_id,cpf_normalized,email_normalized").eq("cpf_normalized", data.cpf).maybeSingle(),
    admin.from("app_people").select("id,user_id,cpf_normalized,email_normalized").eq("email_normalized", data.email).maybeSingle(),
  ]);

  if (cpfResult.error || emailResult.error) {
    reportFailure({
      category: "registration_existing_lookup_failed",
      requestId,
      detail: (cpfResult.error ?? emailResult.error)?.code ?? "unknown",
    });
    throw registrationError("REGISTRATION_DATABASE_UNAVAILABLE", 503);
  }

  if (
    cpfResult.data &&
    emailResult.data &&
    cpfResult.data.user_id !== emailResult.data.user_id
  ) {
    throw registrationError("REGISTRATION_IDENTITY_CONFLICT", 409);
  }

  return (cpfResult.data ?? emailResult.data ?? null) as ExistingPerson | null;
}

async function addRoleToExistingIdentity(
  data: Registration,
  role: "consumer" | "producer",
  requestId: string,
) {
  if (!supabaseAdmin) return null;

  const person = await findExistingPerson(data, requestId);
  if (!person) return null;

  if (
    person.cpf_normalized !== data.cpf ||
    person.email_normalized !== data.email
  )
    throw registrationError(
      "REGISTRATION_CPF_LINKED_TO_EXISTING_ACCOUNT",
      409,
    );

  const client = createSupabasePublicClient();
  if (!client)
    throw registrationError("REGISTRATION_AUTH_UNAVAILABLE", 503);

  const verified = await client.auth.signInWithPassword({
    email: data.email,
    password: data.password,
  });

  if (verified.error || !verified.data.user) {
    const code = verified.error?.code ?? "";
    const message = verified.error?.message?.toLowerCase() ?? "";
    if (code === "email_not_confirmed" || message.includes("email not confirmed"))
      throw registrationError(
        "REGISTRATION_EXISTING_ACCOUNT_CONFIRM_REQUIRED",
        409,
      );

    throw registrationError(
      "REGISTRATION_EXISTING_ACCOUNT_CREDENTIALS_INVALID",
      409,
    );
  }

  try {
    if (!verified.data.user.email_confirmed_at)
      throw registrationError("REGISTRATION_EXISTING_ACCOUNT_CONFIRM_REQUIRED", 409);
    if (verified.data.user.id !== person.user_id)
      throw registrationError("REGISTRATION_IDENTITY_CONFLICT", 409);

    const added = await supabaseAdmin.rpc(
      "add_public_role_to_existing_identity",
      {
        p_user_id: person.user_id,
        p_cpf_normalized: data.cpf,
        p_email_normalized: data.email,
        p_role: role,
        p_property_name:
          role === "producer" ? data.propertyName ?? null : null,
        p_activity_type:
          role === "producer" ? data.activityType ?? null : null,
      },
    );

    if (added.error) {
      reportFailure({
        category: "registration_existing_role_rpc_failed",
        requestId,
        detail: added.error.code ?? "unknown",
      });

      if (
        added.error.code === "23505" ||
        added.error.message?.includes("ROLE_ALREADY_ASSIGNED")
      )
        throw registrationError("REGISTRATION_ROLE_ALREADY_ASSIGNED", 409);

      if (added.error.code === "22023")
        throw registrationError("REGISTRATION_DATA_REJECTED", 400);

      if (added.error.code === "PGRST202" || added.error.code === "42883")
        throw registrationError("REGISTRATION_SCHEMA_OUTDATED", 503);

      throw registrationError("REGISTRATION_DATABASE_UNAVAILABLE", 503);
    }

    return {
      userId: person.user_id,
      confirmationRequired: false,
      confirmationDispatchAccepted: false,
      existingIdentity: true,
      roleAdded: true,
      role,
    };
  } finally {
    await client.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
}

export async function register(
  data: Registration,
  role: "consumer" | "producer",
  requestId: string,
) {
  if (!supabaseAdmin) {
    reportFailure({
      category: "registration_privileged_client_unavailable",
      requestId,
      detail: "edge_fallback",
    });
    return registerThroughEdge(data, role, requestId);
  }

  const existing = await addRoleToExistingIdentity(
    data,
    role,
    requestId,
  );
  if (existing) return existing;

  let userId: string | undefined;

  try {
    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: false,
    });

    if (created.error || !created.data.user) {
      const status = created.error?.status;

      // Corrida de duas requisições: se outra criou a identidade entre a busca
      // e o createUser, tenta reconciliar como conta existente.
      if (status === 422) {
        const reconciled = await addRoleToExistingIdentity(
          data,
          role,
          requestId,
        );
        if (reconciled) return reconciled;
      }

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
      message === "REGISTRATION_ROLE_ALREADY_ASSIGNED" ||
      message === "REGISTRATION_CPF_LINKED_TO_EXISTING_ACCOUNT" ||
      message === "REGISTRATION_EXISTING_ACCOUNT_CREDENTIALS_INVALID" ||
      message === "REGISTRATION_EXISTING_ACCOUNT_CONFIRM_REQUIRED" ||
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


  return {
    userId,
    confirmationRequired: true,
    confirmationDispatchAccepted: false,
    confirmationDispatchDeferred: true,
    existingIdentity: false,
    roleAdded: true,
    role,
  };
}
