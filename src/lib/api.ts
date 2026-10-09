import {
  clearAdminSession,
  readAdminAccessToken,
  readAdminRefreshToken,
  readAdminSessionIdentityVersion,
  saveAdminSession,
} from "./adminSessionStore";

let refreshing: Promise<boolean> | null = null;
let confirmingIdentity: Promise<void> | null = null;

export type ApiFailure = Error & {
  status?: number;
  fields?: Array<{ field: string; message: string }>;
  requestId?: string;
  currentRevision?: number;
  retryAfterSeconds?: number;
  actorId?: string;
};

function failure(code: string, details: Partial<ApiFailure> = {}): ApiFailure {
  return Object.assign(new Error(code), details);
}

async function parseResponse(response: Response) {
  const requestId = response.headers.get("x-request-id") ?? undefined;
  const raw = await response.text();

  if (!raw) return { json: null as unknown, requestId };

  try {
    return { json: JSON.parse(raw) as Record<string, unknown>, requestId };
  } catch {
    if (!response.ok) return { json: {} as Record<string, unknown>, requestId };

    throw failure("INVALID_API_RESPONSE", {
      status: response.status,
      requestId,
    });
  }
}

function apiBases() {
  if (typeof location === "undefined") return ["/api"];

  const hostname = location.hostname.toLowerCase();
  const vercelOrCanonical =
    hostname === "hortvitalmix.vercel.app" ||
    hostname.endsWith(".vercel.app") ||
    hostname === "hortivitalmix.com.br";

  // Google AI Studio pode executar bundle de produção mesmo no preview.
  // Por isso não usamos import.meta.env.DEV para decidir o transporte.
  return vercelOrCanonical ? ["/api"] : ["/_hvm_api", "/api"];
}

async function shouldTryAlternateBase(response: Response) {
  if (response.status === 404 || response.status === 405) return true;
  if (response.status !== 403) return false;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return true;

  const body = await response
    .clone()
    .json()
    .catch(() => ({}) as { error?: string; status?: string });
  const code = String(body.error ?? body.status ?? "");
  return ![
    "email_not_authorized",
    "BOOTSTRAP_EMAIL_NOT_AUTHORIZED",
    "ORIGIN_REJECTED",
    "ORIGIN_NOT_ALLOWED",
    "already_closed",
    "disabled",
  ].includes(code);
}

async function fetchApiPath(
  path: string,
  options: RequestInit,
  credentials: RequestCredentials,
) {
  const bases = apiBases();
  let lastResponse: Response | null = null;

  for (let index = 0; index < bases.length; index++) {
    const response = await doFetch(bases[index] + path, options, credentials);
    lastResponse = response;
    if (index < bases.length - 1 && (await shouldTryAlternateBase(response)))
      continue;
    return { response, base: bases[index] };
  }

  return { response: lastResponse!, base: bases[bases.length - 1] };
}

async function doFetch(
  url: string,
  options: RequestInit,
  credentials: RequestCredentials,
) {
  const adminToken = url.includes("/admin/") ? readAdminAccessToken() : "";
  try {
    return await fetch(url, {
      ...options,
      credentials,
      headers: {
        "Content-Type": "application/json",
        "X-HVM-Request": "1",
        ...(adminToken ? { Authorization: "Bearer " + adminToken } : {}),
        ...options.headers,
      },
      signal: options.signal ?? AbortSignal.timeout(20000),
    });
  } catch (error) {
    const name = (error as { name?: string })?.name;
    throw failure(
      name === "TimeoutError" || name === "AbortError"
        ? "REQUEST_TIMEOUT"
        : "NETWORK_UNAVAILABLE",
    );
  }
}

export function apiBase() {
  return apiBases()[0];
}

export async function withAdminIdentityConfirmation<T>(
  confirm: () => Promise<T>,
): Promise<T> {
  // As respostas de renovação também gravam cookies HttpOnly. Aguarde-as
  // antes da confirmação e impeça outra renovação durante a troca de sessão.
  await refreshing;
  while (confirmingIdentity) await confirmingIdentity;
  let release!: () => void;
  const confirmation = new Promise<void>((resolve) => {
    release = resolve;
  });
  confirmingIdentity = confirmation;
  try {
    // O bloqueio também abrange a validação da identidade e a adoção do
    // token. Requisições em espera retomarão com a sessão já confirmada.
    return await confirm();
  } finally {
    if (confirmingIdentity === confirmation) confirmingIdentity = null;
    release();
  }
}

export async function api<T>(
  path: string,
  options: RequestInit & { timeoutMs?: number } = {},
  retried = false,
): Promise<T> {
  return performApi<T>(path, options, retried);
}

async function performApi<T>(
  path: string,
  options: RequestInit & { timeoutMs?: number },
  retried: boolean,
): Promise<T> {
  const requestIdentityVersion = readAdminSessionIdentityVersion();
  const { timeoutMs, ...init } = options;
  const requestInit: RequestInit = {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(timeoutMs ?? 20000),
  };
  const first = await fetchApiPath(path, requestInit, "same-origin");
  let response = first.response;
  const base = first.base;

  // A confirmação de identidade é uma ação explícita: renovar o JWT não
  // comprova a senha e não deve repetir uma operação administrativa sensível.
  const adminAuthFailure =
    response.status === 401 && path.startsWith("/v1/admin")
      ? await response
          .clone()
          .json()
          .catch(() => ({}) as Record<string, unknown>)
      : null;
  const adminFailureCode = String(
    adminAuthFailure?.error ??
      adminAuthFailure?.status ??
      adminAuthFailure?.code ??
      "",
  );
  const requiresIdentityConfirmation = [
    "ADMIN_REAUTHENTICATION_REQUIRED",
    "ADMIN_REAUTH_REQUIRED",
    "REAUTH_REQUIRED",
    "RECENT_AUTH_REQUIRED",
  ].includes(adminFailureCode);
  if (
    response.status === 401 &&
    !retried &&
    confirmingIdentity &&
    path !== "/v1/admin/auth/reauthenticate" &&
    ((path.startsWith("/v1/admin") && !requiresIdentityConfirmation) ||
      path === "/v1/auth/session")
  ) {
    await confirmingIdentity;
    if (
      (options.method ?? "GET").toUpperCase() !== "GET" &&
      requestIdentityVersion !== readAdminSessionIdentityVersion()
    )
      throw failure("SESSION_CHANGED", { status: 401 });
    return api<T>(path, options, true);
  }
  const canRefreshAdminEndpoint =
    !path.startsWith("/v1/admin/auth/") ||
    ([
      "/v1/admin/auth/reauthenticate",
      "/v1/admin/auth/verify-session",
    ].includes(path) &&
      adminFailureCode === "UNAUTHORIZED");
  if (
    response.status === 401 &&
    !retried &&
    path.startsWith("/v1/admin") &&
    canRefreshAdminEndpoint &&
    !requiresIdentityConfirmation
  ) {
    const refreshToken = readAdminRefreshToken();
    const identityVersion = readAdminSessionIdentityVersion();
    if (refreshToken) {
      refreshing ??= fetch(base + "/v1/auth/refresh", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-HVM-Request": "1" },
        body: JSON.stringify({ refreshToken }),
        signal: AbortSignal.timeout(10000),
      })
        .then(async (refreshed) => {
          // Uma confirmação em outra requisição/aba pode ter criado uma sessão
          // nova enquanto esta renovação estava em trânsito. Preserve-a.
          if (identityVersion !== readAdminSessionIdentityVersion())
            return false;
          if (readAdminRefreshToken() !== refreshToken)
            return Boolean(readAdminAccessToken());
          if (!refreshed.ok) {
            clearAdminSession();
            return false;
          }
          const body = (await refreshed.json()) as {
            accessToken?: string;
            refreshToken?: string;
            expiresIn?: number;
          };
          if (identityVersion !== readAdminSessionIdentityVersion())
            return false;
          if (readAdminRefreshToken() !== refreshToken)
            return Boolean(readAdminAccessToken());
          if (!body.accessToken || !body.refreshToken) {
            clearAdminSession();
            return false;
          }
          saveAdminSession({
            accessToken: body.accessToken,
            refreshToken: body.refreshToken,
            expiresIn: body.expiresIn ?? 3600,
            preserveIdentity: true,
          });
          return true;
        })
        .catch(() => false)
        .finally(() => {
          refreshing = null;
        });
      if (await refreshing) {
        if (requestIdentityVersion !== readAdminSessionIdentityVersion())
          throw failure("SESSION_CHANGED", { status: 401 });
        return api<T>(path, options, true);
      }
    }
  }

  if (response.status === 401 && !retried && path === "/v1/auth/session") {
    const sessionFailure = await response
      .clone()
      .json()
      .catch(() => ({}) as { error?: string });

    if (sessionFailure?.error === "SESSION_EXPIRED") {
      refreshing ??= fetch(base + "/v1/auth/refresh", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
      })
        .then((r) => r.ok)
        .catch(() => false)
        .finally(() => {
          refreshing = null;
        });
      if (await refreshing) return api<T>(path, options, true);
    }
  }

  if (response.status === 204) return undefined as T;

  const parsed = await parseResponse(response);
  const body = (parsed.json ?? {}) as {
    error?: string;
    status?: string;
    fields?: Array<{ field: string; message: string }>;
    requestId?: string;
    currentRevision?: number;
    retryAfterSeconds?: number;
    actorId?: string;
  };
  const { json, requestId } = parsed;

  if (!response.ok)
    throw failure(
      body.error ??
        (typeof body.status === "string" ? body.status : undefined) ??
        (typeof (json as Record<string, unknown>)?.code === "string"
          ? String((json as Record<string, unknown>).code)
          : `HTTP_${response.status}`),
      {
        status: response.status,
        fields: body.fields,
        requestId: body.requestId ?? requestId,
        currentRevision:
          typeof body.currentRevision === "number"
            ? body.currentRevision
            : undefined,
        retryAfterSeconds:
          typeof body.retryAfterSeconds === "number"
            ? body.retryAfterSeconds
            : undefined,
        actorId: typeof body.actorId === "string" ? body.actorId : undefined,
      },
    );

  if (json === null)
    throw failure("INVALID_API_RESPONSE", {
      status: response.status,
      requestId,
    });

  if (
    (requestInit.method ?? "GET").toUpperCase() !== "GET" &&
    !path.includes("/notifications/") &&
    typeof window !== "undefined"
  )
    window.dispatchEvent(new Event("hvm:notifications-changed"));
  return json as T;
}
