import { api, type ApiFailure } from "./api";

type PublicRole = "consumer" | "producer";

export type PublicRegistrationResult = {
  userId?: string;
  confirmationRequired: boolean;
  confirmationDispatchAccepted: boolean;
  confirmationDispatchDeferred?: boolean;
  existingIdentity?: boolean;
  roleAdded?: boolean;
  role?: PublicRole;
  requestId?: string;
  transport?: "express" | "supabase_edge";
};

const CANONICAL_SUPABASE_URL =
  "https://xipbsazvymkqqfmfegwu.supabase.co";

function edgeUrl() {
  const configured = String(import.meta.env.VITE_SUPABASE_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  const base = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(configured)
    ? configured
    : CANONICAL_SUPABASE_URL;
  return base + "/functions/v1/public-registration";
}

function asFailure(
  status: number,
  body: Record<string, unknown>,
  fallback = "REGISTRATION_EDGE_UNAVAILABLE",
): ApiFailure {
  const code = String(
    body.error ??
      body.status ??
      (status ? `HTTP_${status}` : fallback),
  );
  return Object.assign(new Error(code), {
    status,
    requestId:
      typeof body.requestId === "string" ? body.requestId : undefined,
    fields: Array.isArray(body.fields)
      ? (body.fields as Array<{ field: string; message: string }>)
      : undefined,
  }) as ApiFailure;
}

function shouldUseExpressFallback(error: unknown) {
  const failure = error as ApiFailure;
  const status = failure.status ?? 0;
  if ([401, 403, 404, 405, 500, 502, 503, 504].includes(status)) return true;

  return new Set([
    "NETWORK_UNAVAILABLE",
    "REQUEST_TIMEOUT",
    "INVALID_API_RESPONSE",
    "DEPENDENCY_UNAVAILABLE",
    "AUTH_UNAVAILABLE",
    "DATABASE_UNAVAILABLE",
    "REGISTRATION_INTERNAL_ERROR",
    "REGISTRATION_SCHEMA_OUTDATED",
    "REGISTRATION_EDGE_UNAVAILABLE",
  ]).has(failure.message);
}

async function edgeRegistration(
  role: PublicRole,
  data: Record<string, unknown>,
): Promise<PublicRegistrationResult> {
  let response: Response;
  try {
    response = await fetch(edgeUrl(), {
      method: "POST",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        "X-HVM-Request": "1",
      },
      body: JSON.stringify({ role, data }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    const name = (error as { name?: string })?.name;
    throw Object.assign(
      new Error(
        name === "TimeoutError" || name === "AbortError"
          ? "REQUEST_TIMEOUT"
          : "NETWORK_UNAVAILABLE",
      ),
      { status: 0 },
    ) as ApiFailure;
  }

  const body = (await response
    .json()
    .catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) throw asFailure(response.status, body);

  return {
    ...(body as PublicRegistrationResult),
    transport: "supabase_edge",
  };
}

export async function registerPublicAccount(
  role: PublicRole,
  data: Record<string, unknown>,
): Promise<PublicRegistrationResult> {
  // O cadastro público não depende mais do proxy/runtime do ambiente.
  // Vercel e Google Studio chamam diretamente a Edge canônica; o Express
  // existe apenas como contingência se a própria Edge estiver indisponível.
  try {
    return await edgeRegistration(role, data);
  } catch (error) {
    if (!shouldUseExpressFallback(error)) throw error;

    const result = await api<PublicRegistrationResult>(
      "/v1/auth/register-" + role,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
    return { ...result, transport: result.transport ?? "express" };
  }
}

export const PUBLIC_REGISTRATION_EDGE_URL =
  CANONICAL_SUPABASE_URL + "/functions/v1/public-registration";
