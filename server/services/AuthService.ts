import {
  createSupabasePublicClient,
  supabaseAdmin,
} from "../supabase/client.ts";
import { dbPool } from "../db/pool.ts";
import { reportFailure } from "../config/reportFailure.ts";
import type { Registration } from "../../shared/contracts/auth.ts";
import { LGPD_CADASTRO_POLICY_VERSION } from "../../shared/lgpdCadastro.ts";
import {
  LOCALITY_DISABLED_MESSAGE,
  LOCALITY_NOT_COVERED_MESSAGE,
} from "../../shared/contracts/locality.ts";

type RegistrationFailure = Error & { status?: number };
type ChainState = "complete" | "incomplete" | "unknown";
type RegistrationConsent = { policyVersion: string; ipHash: string; userAgent: string };

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
              : code === "LOCALITY_DISABLED"
                ? "REGISTRATION_LOCALITY_DISABLED"
                : code === "LOCALITY_NOT_COVERED"
                  ? "REGISTRATION_LOCALITY_NOT_COVERED"
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

function edgeRegistrationFailure(
  code: string,
  status: number,
  publicMessage?: string,
) {
  const failure = edgeRegistrationError(code, status);
  if (publicMessage) (failure as { publicMessage?: string }).publicMessage = publicMessage;
  return failure;
}

async function registerThroughEdge(
  data: Registration,
  role: "consumer" | "producer",
  requestId: string,
  consent?: RegistrationConsent,
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
      body: JSON.stringify({ role, data, ...(consent ? { consent: { policyVersion: consent.policyVersion } } : {}) }),
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
    reviewRequired: Boolean(body.reviewRequired),
    userId: typeof body.userId === "string" ? body.userId : undefined,
    confirmationContext: typeof body.confirmationContext === "string" ? body.confirmationContext : undefined,
    confirmationDispatchScheduled: Boolean(body.confirmationDispatchScheduled),
    lgpdRecorded: Boolean(body.lgpdRecorded),
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

function registrationError(
  code: string,
  status: number,
  publicMessage?: string,
): RegistrationFailure {
  return Object.assign(new Error(code), { status, publicMessage });
}

/**
 * Trava de cobertura por localidade (item 2 do proprietário).
 * Falha-fechado: só 'active' libera o cadastro.
 */
async function assertLocalityActive(
  state: string,
  municipality: string,
  requestId: string,
) {
  if (!supabaseAdmin) return;
  const coverage = await supabaseAdmin.rpc("fn_locality_coverage", {
    p_state: state,
    p_name: municipality,
  });
  if (coverage.error) {
    reportFailure({
      category: "registration_locality_rpc_failed",
      requestId,
      detail: coverage.error.code ?? "unknown",
    });
    return;
  }
  if (coverage.data === "active") return;
  const disabled = coverage.data === "inactive";
  throw registrationError(
    disabled ? "REGISTRATION_LOCALITY_DISABLED" : "REGISTRATION_LOCALITY_NOT_COVERED",
    disabled ? 403 : 422,
    disabled ? LOCALITY_DISABLED_MESSAGE : LOCALITY_NOT_COVERED_MESSAGE,
  );
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
    admin.from("app_people").select("id,user_id,cpf_normalized,email_normalized").eq("cpf_normalized", data.cpf).is("archived_at", null).eq("registration_review_pending",false).maybeSingle(),
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

  const state=await supabaseAdmin.from("app_users").select("status").eq("id",person.user_id).single();
  if(state.error)throw registrationError("REGISTRATION_DATABASE_UNAVAILABLE",503);
  if(["blocked","suspended","pending"].includes(state.data.status)) {
    if(person.email_normalized!==data.email && person.cpf_normalized===data.cpf)return null;
    if(person.email_normalized===data.email && person.cpf_normalized===data.cpf){
      const queued=await supabaseAdmin.rpc("request_blocked_registration_review",{p_user_id:person.user_id,p_role:role});
      if(queued.error)throw registrationError("REGISTRATION_DATA_REJECTED",409);
      return {userId:person.user_id,reviewRequired:true,confirmationRequired:false,confirmationDispatchAccepted:false,existingIdentity:true,roleAdded:false,role};
    }
  }

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

    const account = await supabaseAdmin.from("app_users").select("status").eq("id",person.user_id).single();
    if(account.error) throw registrationError("REGISTRATION_DATABASE_UNAVAILABLE",503);
    if(account.data.status === "deleted") {
      const requested = await supabaseAdmin.rpc("request_account_reactivation", {p_user_id:person.user_id,p_role:role});
      if(requested.error) throw registrationError("REGISTRATION_DATA_REJECTED",409);
      return {userId:person.user_id,reviewRequired:true,confirmationRequired:false,confirmationDispatchAccepted:false,existingIdentity:true,roleAdded:false,role};
    }
    if(account.data.status === "pending") return {userId:person.user_id,reviewRequired:true,confirmationRequired:false,confirmationDispatchAccepted:false,existingIdentity:true,roleAdded:false,role};

    // Acrescentar papel a uma identidade existente também respeita a trava de
    // cobertura: nenhum perfil novo nasce em região fora de operação.
    await assertLocalityActive(data.state, data.municipality, requestId);

    const added = await supabaseAdmin.rpc(
      "add_public_role_to_existing_identity",
      {
        p_user_id: person.user_id,
        p_cpf_normalized: data.cpf,
        p_email_normalized: data.email,
        p_role: role,
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

export async function recordLgpdCadastroAcceptance(input: {
  userId: string;
  email: string;
  ipHash: string;
  userAgent: string;
}) {
  const email = input.email.trim().toLowerCase();
  const ipHash = /^[0-9a-f]{64}$/.test(input.ipHash) ? input.ipHash : "0".repeat(64);
  const userAgent = (input.userAgent || "unknown").slice(0, 255) || "unknown";

  if (supabaseAdmin) {
    const person = await supabaseAdmin
      .from("app_people")
      .select("id,email_normalized")
      .eq("user_id", input.userId)
      .is("archived_at", null)
      .maybeSingle();
    if (person.error) return { status: "unavailable" as const };
    if (!person.data || person.data.email_normalized !== email)
      return { status: "ignored" as const };
    const existing = await supabaseAdmin
      .from("app_consent_records")
      .select("id")
      .eq("person_id", person.data.id)
      .eq("consent_type", "lgpd_cadastro")
      .eq("policy_version", LGPD_CADASTRO_POLICY_VERSION)
      .eq("is_granted", true)
      .limit(1);
    if (existing.error) return { status: "unavailable" as const };
    if (existing.data?.length) return { status: "already_recorded" as const };
    const inserted = await supabaseAdmin.from("app_consent_records").insert({
      person_id: person.data.id,
      consent_type: "lgpd_cadastro",
      is_granted: true,
      policy_version: LGPD_CADASTRO_POLICY_VERSION,
      ip_hash: ipHash,
      user_agent: userAgent,
    });
    if (inserted.error) return { status: "unavailable" as const };
    return { status: "recorded" as const };
  }

  if (!dbPool) return { status: "unavailable" as const };
  try {
    const person = await dbPool.query<{ id: string }>(
      `SELECT id FROM public.app_people
        WHERE user_id=$1 AND email_normalized=$2 AND archived_at IS NULL
        LIMIT 1`,
      [input.userId, email],
    );
    if (!person.rows[0]) return { status: "ignored" as const };
    await dbPool.query(
      `INSERT INTO public.app_consent_records
         (person_id,consent_type,is_granted,policy_version,ip_hash,user_agent)
       SELECT $1,'lgpd_cadastro',true,$2,$3,$4
        WHERE NOT EXISTS (
          SELECT 1 FROM public.app_consent_records
           WHERE person_id=$1 AND consent_type='lgpd_cadastro'
             AND policy_version=$2 AND is_granted=true
        )`,
      [person.rows[0].id, LGPD_CADASTRO_POLICY_VERSION, ipHash, userAgent],
    );
    return { status: "recorded" as const };
  } catch {
    return { status: "unavailable" as const };
  }
}

export async function register(
  data: Registration,
  role: "consumer" | "producer",
  requestId: string,
  consent?: RegistrationConsent,
) {
  if (!supabaseAdmin) {
    reportFailure({
      category: "registration_privileged_client_unavailable",
      requestId,
      detail: "edge_fallback",
    });
    return registerThroughEdge(data, role, requestId, consent);
  }

  const existing = await addRoleToExistingIdentity(
    data,
    role,
    requestId,
  );
  if (existing) return existing;

  let userId: string | undefined;
  let completedStatus: string | undefined;

  try {
    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: false,
      user_metadata: { full_name: data.fullName, hvm_portal: "public", hvm_registration_role: role },
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
      const completed = await supabaseAdmin.rpc(consent ? "complete_public_registration_with_consent" : "complete_public_registration", {
        p_user_id: userId,
        p_full_name: data.fullName,
        p_cpf_normalized: data.cpf,
        p_email_normalized: data.email,
        p_phone_e164: data.phone,
        p_role: role,
        p_municipality: data.municipality,
        p_state: data.state,
        ...(consent ? { p_policy_version: consent.policyVersion, p_ip_hash: consent.ipHash, p_user_agent: consent.userAgent.slice(0, 255) || "unknown" } : {}),
      });

      if (completed.error)
        throw mapDomainRegistrationError(completed.error, requestId);
      if (consent) completedStatus = completed.data?.status;
    } catch (error) {
      const message = (error as Error)?.message;
      const knownFailure =
        message === "REGISTRATION_IDENTITY_CONFLICT" ||
        message === "REGISTRATION_AUTH_UNAVAILABLE" ||
        message === "REGISTRATION_DATABASE_UNAVAILABLE" ||
        message === "REGISTRATION_SCHEMA_OUTDATED" ||
        message === "REGISTRATION_LOCALITY_DISABLED" ||
        message === "REGISTRATION_LOCALITY_NOT_COVERED" ||
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


  const accountState = completedStatus ? { data: { status: completedStatus }, error: null } : await supabaseAdmin.from("app_users").select("status").eq("id",userId!).single();
  if(accountState.error)throw registrationError("REGISTRATION_STATUS_UNKNOWN",503);
  return {
    userId,
    reviewRequired: accountState.data?.status === "pending",
    confirmationRequired: accountState.data?.status === "active",
    confirmationDispatchAccepted: false,
    confirmationDispatchDeferred: accountState.data?.status === "active",
    existingIdentity: false,
    roleAdded: true,
    role,
    lgpdRecorded: Boolean(consent && completedStatus),
  };
}
