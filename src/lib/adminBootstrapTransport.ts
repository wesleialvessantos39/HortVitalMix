import { api, type ApiFailure } from "./api";

export type BootstrapStatus = {
  status: "open" | "closed" | "disabled";
  reason: string | null;
  authorizedEmailHint?: string | null;
};

export type BootstrapCommand = {
  fullName: string;
  cpf: string;
  email: string;
  phone: string;
  password: string;
  commandId: string;
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
  return base + "/functions/v1/admin-bootstrap";
}

function edgeFailure(
  status: number,
  body: Record<string, unknown>,
): ApiFailure {
  const code = String(
    body.error ??
      body.status ??
      (status ? `HTTP_${status}` : "BOOTSTRAP_EDGE_UNAVAILABLE"),
  );
  return Object.assign(new Error(code), { status }) as ApiFailure;
}

async function edgeRequest<T>(
  method: "GET" | "POST",
  body?: BootstrapCommand,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(edgeUrl(), {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw Object.assign(new Error("BOOTSTRAP_EDGE_UNAVAILABLE"), {
      status: 503,
    }) as ApiFailure;
  }

  const payload = (await response
    .json()
    .catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) throw edgeFailure(response.status, payload);
  return payload as T;
}

function shouldUseEdgeFallback(error: unknown) {
  const failure = error as ApiFailure;
  if (!failure || typeof failure !== "object") return true;
  if (!failure.status) return true;
  if (failure.status >= 500) return true;
  if (failure.status === 404 || failure.status === 405) return true;
  if (
    failure.status === 403 &&
    ![
      "BOOTSTRAP_EMAIL_NOT_AUTHORIZED",
      "email_not_authorized",
      "BOOTSTRAP_ALREADY_CLOSED",
    ].includes(failure.message)
  )
    return true;
  return false;
}

export async function getBootstrapStatus(): Promise<BootstrapStatus> {
  try {
    return await api<BootstrapStatus>("/v1/admin/bootstrap/status");
  } catch {
    return edgeRequest<BootstrapStatus>("GET");
  }
}

export async function runBootstrap(
  input: BootstrapCommand,
): Promise<{ status: string; userId?: string; requestId?: string }> {
  try {
    return await api("/v1/admin/bootstrap", {
      method: "POST",
      body: JSON.stringify(input),
    });
  } catch (error) {
    if (!shouldUseEdgeFallback(error)) throw error;
    return edgeRequest("POST", input);
  }
}
