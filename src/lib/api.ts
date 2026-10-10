import {
  clearAdminSession,
  readAdminAccessToken,
  readAdminRefreshToken,
  readAdminSessionIdentityVersion,
  saveAdminSession,
} from "./adminSessionStore";
import {
  fetchAppApi,
  hasPendingNativeMutations,
  hasPendingNativeSessionChanges,
  nativeBackendOrigin,
  waitForNativeSessionChanges,
} from "./nativeTransport";
import { pwaTransitionHeld, waitForPwaTransition } from "./pwaTransition";

let refreshing: Promise<boolean> | null = null;
let confirmingIdentity: Promise<void> | null = null;
let pendingApiMutations = 0;

export function hasPendingApiMutations() {
  return pendingApiMutations > 0 || hasPendingNativeMutations();
}

export function hasPendingSessionChanges() {
  return (
    Boolean(refreshing || confirmingIdentity) ||
    hasPendingNativeSessionChanges()
  );
}

function publishMutationState() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("hvm:api-mutating"));
}

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
  const nativeOrigin = nativeBackendOrigin();
  if (nativeOrigin) return [nativeOrigin + "/api"];
  if (typeof location === "undefined") return ["/api"];

  const hostname = location.hostname.toLowerCase();
  const studioPreview =
    hostname === "aistudio.google.com" ||
    hostname.endsWith(".usercontent.goog") ||
    hostname.endsWith(".googleusercontent.com");

  // Google AI Studio pode executar bundle de produção mesmo no preview.
  // Por isso não usamos import.meta.env.DEV para decidir o transporte.
  // Todo domínio publicado pela Vercel usa a mesma rota /api. Não inferir
  // preview de um domínio desconhecido: /_hvm_api pode responder o HTML da
  // SPA com status 200 e interromper login, sessões e comandos sensíveis.
  return studioPreview ? ["/_hvm_api", "/api"] : ["/api"];
}

async function shouldTryAlternateBase(response: Response, method: string) {
  // A preview proxy may serve the application HTML instead of its read API.
  // Only safe reads can use this recovery; never replay a submitted command
  // after an ambiguous successful response.
  if (response.ok && ["GET", "HEAD"].includes(method)) {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) return true;
  }
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
    if (
      index < bases.length - 1 &&
      (await shouldTryAlternateBase(
        response,
        (options.method ?? "GET").toUpperCase(),
      ))
    )
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
    return await fetchAppApi(url, {
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

// Protected files share the native cookie jar and the administrative bearer
// used by JSON endpoints. Blob URLs remain local to the document viewer.
export async function fetchApiFile(path: string, options: RequestInit = {}) {
  const base = apiBase();
  const url = path.startsWith("/v1/") ? base + path : path;
  const headers = new Headers(options.headers);
  const nativeOrigin = nativeBackendOrigin();
  const browserOrigin =
    nativeOrigin ??
    (typeof location === "undefined" ? "http://localhost" : location.origin);
  const resolved = new URL(url, browserOrigin);
  const expected = new URL(base + "/", browserOrigin);
  if (
    resolved.origin !== expected.origin ||
    !/^\/(?:api|_hvm_api)\/v1\//.test(resolved.pathname)
  )
    throw failure("API_FILE_URL_REJECTED");
  const token = resolved.pathname.startsWith(
    expected.pathname.replace(/\/$/, "") + "/v1/admin/",
  )
    ? readAdminAccessToken()
    : "";
  if (token) headers.set("Authorization", "Bearer " + token);
  headers.set("X-HVM-Request", "1");
  return fetchAppApi(
    url,
    {
      ...options,
      headers,
      credentials: "same-origin",
      signal: options.signal ?? AbortSignal.timeout(20000),
    },
    true,
  );
}

export async function withAdminIdentityConfirmation<T>(
  confirm: () => Promise<T>,
): Promise<T> {
  if (pwaTransitionHeld()) await waitForPwaTransition();
  // As respostas de renovação também gravam cookies HttpOnly. Aguarde-as
  // antes da confirmação e impeça outra renovação durante a troca de sessão.
  await refreshing;
  await waitForNativeSessionChanges();
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
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(
    (options.method ?? "GET").toUpperCase(),
  );
  if (mutation) {
    if (pwaTransitionHeld()) await waitForPwaTransition();
    pendingApiMutations++;
    publishMutationState();
  }
  try {
    return await performApi<T>(path, options, retried);
  } finally {
    if (mutation) {
      pendingApiMutations--;
      publishMutationState();
    }
  }
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
      if (pwaTransitionHeld()) await waitForPwaTransition();
      refreshing ??= fetchAppApi(base + "/v1/auth/refresh", {
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
      if (pwaTransitionHeld()) await waitForPwaTransition();
      refreshing ??= fetchAppApi(base + "/v1/auth/refresh", {
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
