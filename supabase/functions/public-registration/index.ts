import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { z } from "npm:zod@4.6.5";

const CANONICAL_APP_ORIGIN = "https://hortvitalmix.vercel.app";
const MAX_BODY_BYTES = 32 * 1024;

const onlyDigits = (value: string) => value.replace(/\D/g, "");

function validCpf(value: string) {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  for (let n = 9; n < 11; n += 1) {
    let sum = 0;
    for (let i = 0; i < n; i += 1)
      sum += Number(value[i]) * (n + 1 - i);
    const digit = (sum * 10) % 11;
    if ((digit === 10 ? 0 : digit) !== Number(value[n])) return false;
  }
  return true;
}

function normalizePhone(value: string) {
  const digits = onlyDigits(value);
  if (digits.startsWith("55") && digits.length === 13) return "+" + digits;
  if (digits.length === 11) return "+55" + digits;
  return value.trim();
}

const StrongPasswordSchema = z
  .string()
  .min(12)
  .max(70)
  .regex(/[a-z]/)
  .regex(/[A-Z]/)
  .regex(/\d/)
  .regex(/[^A-Za-z0-9\s]/);

const email = z.string().trim().toLowerCase().max(255).pipe(z.email());
const cpf = z
  .string()
  .transform((value) => onlyDigits(value))
  .refine(validCpf, "CPF inválido");
const phone = z
  .string()
  .transform(normalizePhone)
  .refine((value) => /^\+55[1-9]\d9\d{8}$/.test(value), "Celular inválido");

// Trava de cobertura por localidade: o município declarado precisa existir no
// catálogo do Super administrador e estar ATIVO (validado na função de domínio).
const municipality = z
  .string()
  .trim()
  .min(3, "Informe o nome do município")
  .max(100);
const state = z
  .string()
  .trim()
  .length(2, "Use a sigla da UF com 2 letras")
  .transform((value) => value.toUpperCase())
  .default("RO");

const base = {
  fullName: z.string().trim().min(3).max(255),
  cpf,
  email,
  password: StrongPasswordSchema,
  phone,
  municipality,
  state,
};

const ConsumerSchema = z.object(base).strict();
const ProducerSchema = z.object(base).strict();

const RequestSchema = z
  .object({
    role: z.enum(["consumer", "producer"]),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();

type Role = "consumer" | "producer";
type Registration = z.infer<typeof ConsumerSchema>;

const responseHeaders = (origin: string | null) => ({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "access-control-allow-origin": origin ?? "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,x-hvm-request",
  "access-control-max-age": "600",
  vary: "Origin",
});

const json = (
  status: number,
  body: unknown,
  origin: string | null,
) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: responseHeaders(origin),
  });

function safeFailure(
  status: number,
  error: string,
  requestId: string,
  origin: string | null,
  fields?: Array<{ field: string; message: string }>,
) {
  return json(
    status,
    {
      error,
      requestId,
      ...(fields?.length ? { fields } : {}),
    },
    origin,
  );
}

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

function logFailure(requestId: string, category: string, detail?: string) {
  console.error(
    JSON.stringify({
      severity: "error",
      requestId,
      category,
      ...(detail ? { detail } : {}),
    }),
  );
}

// Mensagens literais da trava de cobertura por localidade.
const LOCALITY_DISABLED_MESSAGE =
  "Sua região está bloqueada. Dúvidas, entre em contato conosco: hortivitalmix@gmail.com.";
const LOCALITY_NOT_COVERED_MESSAGE =
  "Sua região está fora de cobertura. Dúvidas, entre em contato conosco: hortivitalmix@gmail.com.";

/**
 * Trava de cobertura. Falha-fechado: qualquer resposta que não seja
 * explicitamente 'active' interrompe o cadastro naquela localidade.
 */
function localityBlocked(
  coverage: unknown,
  requestId: string,
  origin: string | null,
) {
  const disabled = coverage === "inactive";
  return json(
    disabled ? 403 : 422,
    {
      error: disabled ? "LOCALITY_DISABLED" : "LOCALITY_NOT_COVERED",
      message: disabled ? LOCALITY_DISABLED_MESSAGE : LOCALITY_NOT_COVERED_MESSAGE,
      requestId,
    },
    origin,
  );
}

async function assertLocalityActive(
  admin: ReturnType<typeof createClient>,
  state: string,
  municipality: string,
  requestId: string,
  origin: string | null,
) {
  const coverage = await admin.rpc("fn_locality_coverage", {
    p_state: state,
    p_name: municipality,
  });
  if (coverage.error) {
    logFailure(
      requestId,
      "public_registration_locality_rpc_failed",
      coverage.error.code ?? "unknown",
    );
    return safeFailure(503, "DATABASE_UNAVAILABLE", requestId, origin);
  }
  if (coverage.data !== "active")
    return localityBlocked(coverage.data, requestId, origin);
  return null;
}

function mapRpcError(
  error: { code?: string | null; message?: string | null },
  requestId: string,
  origin: string | null,
) {
  const code = error.code ?? "unknown";
  const message = String(error.message ?? "");
  logFailure(requestId, "public_registration_rpc_failed", code);

  if (code === "HVMLC" || message.includes("REGISTRATION_LOCALITY_"))
    return localityBlocked(
      message.includes("REGISTRATION_LOCALITY_DISABLED") ? "inactive" : "unknown",
      requestId,
      origin,
    );

  if (
    code === "23505" &&
    String(error.message ?? "").includes("ROLE_ALREADY_ASSIGNED")
  )
    return safeFailure(409, "ROLE_ALREADY_ASSIGNED", requestId, origin);

  if (code === "23505")
    return safeFailure(409, "IDENTITY_CONFLICT", requestId, origin);

  if (code === "22023")
    return safeFailure(400, "REGISTRATION_DATA_REJECTED", requestId, origin);

  if (code === "PGRST202" || code === "42883")
    return safeFailure(
      503,
      "REGISTRATION_SCHEMA_OUTDATED",
      requestId,
      origin,
    );

  return safeFailure(503, "DATABASE_UNAVAILABLE", requestId, origin);
}

type ExistingPerson = {
  id: string;
  user_id: string;
  cpf_normalized: string;
  email_normalized: string;
};

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const requestId = crypto.randomUUID();

  if (req.method === "OPTIONS") return json(204, null, origin);
  if (req.method !== "POST")
    return safeFailure(405, "METHOD_NOT_ALLOWED", requestId, origin);

  const length = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BODY_BYTES)
    return safeFailure(413, "PAYLOAD_TOO_LARGE", requestId, origin);

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "")
    .trim()
    .replace(/\/+$/, "");
  const anonKey =
    Deno.env.get("SUPABASE_ANON_KEY")?.trim() ||
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY")?.trim() ||
    readNamedKeyMap(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"));
  const serviceRole =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ||
    Deno.env.get("SUPABASE_SECRET_KEY")?.trim() ||
    readNamedKeyMap(Deno.env.get("SUPABASE_SECRET_KEYS"));

  if (!supabaseUrl || !anonKey || !serviceRole) {
    logFailure(requestId, "public_registration_runtime_unavailable");
    return safeFailure(503, "AUTH_UNAVAILABLE", requestId, origin);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return safeFailure(400, "INVALID_JSON", requestId, origin);
  }

  const envelope = RequestSchema.safeParse(raw);
  if (!envelope.success)
    return safeFailure(
      400,
      "VALIDATION_ERROR",
      requestId,
      origin,
      envelope.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    );

  const role = envelope.data.role as Role;
  const parsed = (
    role === "producer" ? ProducerSchema : ConsumerSchema
  ).safeParse(envelope.data.data);

  if (!parsed.success)
    return safeFailure(
      400,
      "VALIDATION_ERROR",
      requestId,
      origin,
      parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    );

  const data = parsed.data as Registration;

  const publicClient = createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const admin = createClient(supabaseUrl, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  let existing: ExistingPerson | null = null;
  try {
    const lookup = await admin
      .from("app_people")
      .select("id,user_id,cpf_normalized,email_normalized")
      .or(
        `and(cpf_normalized.eq.${data.cpf},archived_at.is.null),and(email_normalized.eq.${JSON.stringify(
          data.email,
        )},archived_at.is.null)`,
      )
      .limit(2);

    if (lookup.error) {
      logFailure(
        requestId,
        "public_registration_identity_lookup_failed",
        lookup.error.code ?? "unknown",
      );
      return safeFailure(503, "DATABASE_UNAVAILABLE", requestId, origin);
    }

    const rows = (lookup.data ?? []) as ExistingPerson[];
    if (rows.length > 1 && rows[0].user_id !== rows[1].user_id)
      return safeFailure(409, "IDENTITY_CONFLICT", requestId, origin);
    existing = rows[0] ?? null;
  } catch {
    logFailure(requestId, "public_registration_identity_lookup_transport");
    return safeFailure(503, "DATABASE_UNAVAILABLE", requestId, origin);
  }

  if (existing) {
    const account = await admin
      .from("app_users")
      .select("status")
      .eq("id",existing.user_id)
      .maybeSingle();
    if(account.error)
      return safeFailure(503,"DATABASE_UNAVAILABLE",requestId,origin);

    if (
      account.data?.status === "blocked" ||
      account.data?.status === "deleted"
    ) {
      const requested = await admin.rpc("request_account_reactivation", {
        p_user_id:existing.user_id,
        p_role:role,
      });
      if(requested.error)
        return safeFailure(409,"REACTIVATION_NOT_ALLOWED",requestId,origin);
      return json(201,{
        userId:existing.user_id,
        reviewRequired:true,
        confirmationRequired:true,
        confirmationDispatchAccepted:false,
        confirmationDispatchDeferred:true,
        existingIdentity:true,
        roleAdded:false,
        role,
        requestId,
      },origin);
    }

    if(account.data?.status === "pending")
      return json(201,{
        userId:existing.user_id,
        reviewRequired:true,
        confirmationRequired:true,
        confirmationDispatchAccepted:false,
        confirmationDispatchDeferred:true,
        existingIdentity:true,
        roleAdded:false,
        role,
        requestId,
      },origin);

    if (
      existing.cpf_normalized !== data.cpf ||
      existing.email_normalized !== data.email
    )
      return safeFailure(
        409,
        "CPF_LINKED_TO_EXISTING_ACCOUNT",
        requestId,
        origin,
      );

    const verified = await publicClient.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (verified.error || !verified.data.user) {
      const authCode = String(verified.error?.code ?? "");
      const authMessage = String(verified.error?.message ?? "").toLowerCase();
      if (
        authCode === "email_not_confirmed" ||
        authMessage.includes("email not confirmed")
      )
        return safeFailure(
          409,
          "EXISTING_ACCOUNT_CONFIRM_REQUIRED",
          requestId,
          origin,
        );

      return safeFailure(
        409,
        "EXISTING_ACCOUNT_CREDENTIALS_INVALID",
        requestId,
        origin,
      );
    }

    try {
      if (!verified.data.user.email_confirmed_at)
        return safeFailure(
          409,
          "EXISTING_ACCOUNT_CONFIRM_REQUIRED",
          requestId,
          origin,
        );
      if (verified.data.user.id !== existing.user_id)
        return safeFailure(409, "IDENTITY_CONFLICT", requestId, origin);

      const blocked = await assertLocalityActive(
        admin,
        data.state,
        data.municipality,
        requestId,
        origin,
      );
      if (blocked) return blocked;

      const added = await admin.rpc("add_public_role_to_existing_identity", {
        p_user_id: existing.user_id,
        p_cpf_normalized: data.cpf,
        p_email_normalized: data.email,
        p_role: role,
      });

      if (added.error)
        return mapRpcError(added.error, requestId, origin);

      return json(
        201,
        {
          userId: existing.user_id,
          confirmationRequired: false,
          confirmationDispatchAccepted: false,
          confirmationDispatchDeferred: false,
          existingIdentity: true,
          roleAdded: true,
          role,
          requestId,
          transport: "supabase_edge",
        },
        origin,
      );
    } finally {
      await publicClient.auth.signOut({ scope: "local" }).catch(() => undefined);
    }
  }



  // Mantém a mesma ordem transacional já homologada no Express:
  // 1) identidade não confirmada, 2) domínio atômico, 3) confirmação por e-mail.
  // Assim uma falha do domínio nunca deixa um link de confirmação para uma
  // identidade que será compensada.
  const created = await admin.auth.admin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: false,
    user_metadata: {
      full_name: data.fullName,
      hvm_portal: "public",
    },
  });

  if (created.error || !created.data.user) {
    const status = Number(created.error?.status ?? 0);
    logFailure(
      requestId,
      "public_registration_auth_create_failed",
      created.error?.code ?? String(status || "unknown"),
    );

    if (status === 429)
      return safeFailure(
        429,
        "REGISTRATION_RATE_LIMITED",
        requestId,
        origin,
      );

    if (status === 422 || status === 400)
      return safeFailure(409, "IDENTITY_CONFLICT", requestId, origin);

    return safeFailure(503, "AUTH_UNAVAILABLE", requestId, origin);
  }

  const userId = created.data.user.id;
  const contextValue = btoa(JSON.stringify({uid:userId,role,exp:Date.now()+24*60*60_000})).replace(/=/g, "").replace(/\+/g,"-").replace(/\//g,"_");
  const contextKey = await crypto.subtle.importKey("raw",new TextEncoder().encode(serviceRole),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const mac = await crypto.subtle.sign("HMAC",contextKey,new TextEncoder().encode("hvm:confirmation:v1:"+contextValue));
  const context = contextValue+"."+Array.from(new Uint8Array(mac),b=>b.toString(16).padStart(2,"0")).join("");
  const redirectTo = CANONICAL_APP_ORIGIN+"/confirmar-contato?portal="+role+"&context="+encodeURIComponent(context);

  const completed = await admin.rpc("complete_public_registration", {
    p_user_id: userId,
    p_full_name: data.fullName,
    p_cpf_normalized: data.cpf,
    p_email_normalized: data.email,
    p_phone_e164: data.phone,
    p_role: role,
    // Localidade declarada: a função de domínio revalida a cobertura e grava o
    // município da pessoa. Sem estes parâmetros o cadastro perderia a região.
    p_municipality: data.municipality,
    p_state: data.state ?? "RO",
  });

  if (completed.error) {
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    return mapRpcError(completed.error, requestId, origin);
  }

  const accountState = await admin.from("app_users").select("status").eq("id",userId).single();
  const reviewRequired = accountState.data?.status === "pending";
  let confirmationDispatchAccepted = false;
  if (!reviewRequired) {
    try {
      const sent = await publicClient.auth.resend({
        type: "signup",
        email: data.email,
        options: { emailRedirectTo: redirectTo },
      });
      confirmationDispatchAccepted = !sent.error;
      if (sent.error)
        logFailure(
          requestId,
          "public_registration_confirmation_deferred",
          sent.error.code ?? String(sent.error.status ?? "unknown"),
        );
    } catch {
      logFailure(requestId, "public_registration_confirmation_transport");
    }
  }

  return json(
    201,
    {
      userId,
      reviewRequired,
      confirmationRequired: true,
      confirmationDispatchAccepted,
      confirmationDispatchDeferred: reviewRequired || !confirmationDispatchAccepted,
      existingIdentity: false,
      roleAdded: true,
      role,
      requestId,
      transport: "supabase_edge",
    },
    origin,
  );
});
