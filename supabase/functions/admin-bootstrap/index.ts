import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const CANONICAL_EMAIL_SHA256 =
  "e5529eeb9b99fcafc370d6fb5855ade0082855cbfee746a7a85aa9a09f29d699";
const ZERO_HASH = "0".repeat(64);

const responseHeaders = (origin: string | null) => ({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "access-control-allow-origin": origin ?? "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers":
    "content-type,authorization,apikey,x-client-info,x-hvm-request",
  vary: "Origin",
});

const json = (status: number, body: unknown, origin: string | null) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: responseHeaders(origin),
  });

const normalizeEmail = (value: unknown) =>
  String(value ?? "")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .trim()
    .toLowerCase();

const onlyDigits = (value: unknown) =>
  String(value ?? "").replace(/\D/g, "");

function readNamedKeyMap(value: string | undefined, name = "default") {
  if (!value?.trim()) return "";
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const candidate = parsed[name];
    return typeof candidate === "string" ? candidate.trim() : "";
  } catch {
    return "";
  }
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validCpf(value: string) {
  const cpf = onlyDigits(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;

  const digit = (size: number) => {
    let sum = 0;
    for (let index = 0; index < size; index++)
      sum += Number(cpf[index]) * (size + 1 - index);
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };

  return (
    digit(9) === Number(cpf[9]) &&
    digit(10) === Number(cpf[10])
  );
}

function validPassword(value: unknown) {
  const password = String(value ?? "");
  return (
    password.length >= 12 &&
    password.length <= 70 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

function normalizePhone(value: unknown) {
  const digits = onlyDigits(value);
  if (digits.startsWith("55") && digits.length === 13) return "+" + digits;
  if (digits.length === 11) return "+55" + digits;
  return String(value ?? "").trim();
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return json(204, null, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ||
    readNamedKeyMap(Deno.env.get("SUPABASE_SECRET_KEYS"));

  if (!supabaseUrl || !serviceRole)
    return json(
      503,
      { status: "unavailable", error: "BOOTSTRAP_UNAVAILABLE" },
      origin,
    );

  const admin = createClient(supabaseUrl, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data: config, error: configError } = await admin
    .from("app_global_config")
    .select("support_email")
    .eq("singleton_guard", true)
    .maybeSingle();

  if (configError)
    return json(
      503,
      { status: "unavailable", error: "BOOTSTRAP_UNAVAILABLE" },
      origin,
    );

  const authorizedEmail = normalizeEmail(config?.support_email);
  if (
    !authorizedEmail ||
    (await sha256(authorizedEmail)) !== CANONICAL_EMAIL_SHA256
  )
    return json(
      503,
      { status: "disabled", error: "BOOTSTRAP_DISABLED" },
      origin,
    );

  const { data: roles, error: rolesError } = await admin
    .from("app_user_role_assignments")
    .select("user_id,expires_at")
    .eq("role_code", "platform_super_admin")
    .is("revoked_at", null)
    .limit(50);

  if (rolesError)
    return json(
      503,
      { status: "unavailable", error: "BOOTSTRAP_UNAVAILABLE" },
      origin,
    );

  const now = Date.now();
  const activeRoleIds = (roles ?? [])
    .filter(
      (row) =>
        !row.expires_at ||
        new Date(row.expires_at).getTime() > now,
    )
    .map((row) => row.user_id);

  if (activeRoleIds.length) {
    const { data: activeUsers, error: usersError } = await admin
      .from("app_users")
      .select("id")
      .in("id", activeRoleIds)
      .eq("status", "active")
      .limit(1);

    if (usersError)
      return json(
        503,
        { status: "unavailable", error: "BOOTSTRAP_UNAVAILABLE" },
        origin,
      );

    if (activeUsers?.length)
      return json(
        req.method === "GET" ? 200 : 409,
        {
          status: "closed",
          error:
            req.method === "GET"
              ? undefined
              : "BOOTSTRAP_ALREADY_CLOSED",
          reason: "Já existe Super administrador ativo.",
        },
        origin,
      );
  }

  if (req.method === "GET")
    return json(
      200,
      { status: "open", reason: null, authorizedEmailHint: null },
      origin,
    );

  if (req.method !== "POST")
    return json(405, { error: "METHOD_NOT_ALLOWED" }, origin);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(
      400,
      {
        status: "validation_failed",
        error: "BOOTSTRAP_VALIDATION_FAILED",
      },
      origin,
    );
  }

  const fullName = String(body.fullName ?? "").trim();
  const cpf = onlyDigits(body.cpf);
  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phone);
  const password = String(body.password ?? "");
  const commandId = String(body.commandId ?? "");

  if (
    fullName.length < 3 ||
    !validCpf(cpf) ||
    !/^\+55[1-9]\d9\d{8}$/.test(phone) ||
    !validPassword(password) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      commandId,
    )
  )
    return json(
      422,
      {
        status: "validation_failed",
        error: "BOOTSTRAP_VALIDATION_FAILED",
      },
      origin,
    );

  if (email !== authorizedEmail)
    return json(
      403,
      {
        status: "email_not_authorized",
        error: "BOOTSTRAP_EMAIL_NOT_AUTHORIZED",
      },
      origin,
    );

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      hvm_portal: "administrative",
    },
  });

  if (created.error || !created.data.user)
    return json(
      409,
      {
        status: "identity_conflict",
        error: "BOOTSTRAP_IDENTITY_CONFLICT",
        message:
          created.error?.message ??
          "Não foi possível criar a identidade.",
      },
      origin,
    );

  const userId = created.data.user.id;

  const cleanup = async () => {
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    await admin
      .from("app_users")
      .delete()
      .eq("id", userId)
      .catch(() => undefined);
  };

  const requestId = crypto.randomUUID();
  const { data: finalized, error: finalizeError } =
    await admin.rpc("fn_finalize_first_super_admin", {
      p_user_id: userId,
      p_full_name: fullName,
      p_cpf_normalized: cpf,
      p_email_normalized: email,
      p_phone_e164: phone,
      p_request_id: requestId,
      p_command_id: commandId,
      p_client_ip_hash: ZERO_HASH,
    });

  if (finalizeError) {
    console.error(
      "bootstrap_finalize_error",
      finalizeError.code,
    );
    await cleanup();
    return json(
      503,
      {
        status: "unavailable",
        error: "BOOTSTRAP_UNAVAILABLE",
        requestId,
      },
      origin,
    );
  }

  const finalStatus = String(finalized?.status ?? "");
  if (finalStatus === "completed")
    return json(
      201,
      {
        status: "completed",
        userId,
        requestId,
      },
      origin,
    );

  await cleanup();

  if (finalStatus === "already_closed")
    return json(
      409,
      {
        status: finalStatus,
        error: "BOOTSTRAP_ALREADY_CLOSED",
        requestId,
      },
      origin,
    );

  if (finalStatus === "email_not_authorized")
    return json(
      403,
      {
        status: finalStatus,
        error: "BOOTSTRAP_EMAIL_NOT_AUTHORIZED",
        requestId,
      },
      origin,
    );

  if (finalStatus === "identity_conflict")
    return json(
      409,
      {
        status: finalStatus,
        error: "BOOTSTRAP_IDENTITY_CONFLICT",
        requestId,
      },
      origin,
    );

  if (finalStatus === "validation_failed")
    return json(
      422,
      {
        status: finalStatus,
        error: "BOOTSTRAP_VALIDATION_FAILED",
        requestId,
      },
      origin,
    );

  if (finalStatus === "disabled")
    return json(
      503,
      {
        status: finalStatus,
        error: "BOOTSTRAP_DISABLED",
        requestId,
      },
      origin,
    );

  return json(
    503,
    {
      status: "unavailable",
      error: "BOOTSTRAP_UNAVAILABLE",
      requestId,
    },
    origin,
  );
});
