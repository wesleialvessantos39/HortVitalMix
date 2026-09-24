let refreshing: Promise<boolean> | null = null;

export type ApiFailure = Error & {
  status?: number;
  fields?: Array<{ field: string; message: string }>;
  requestId?: string;
  currentRevision?: number;
  retryAfterSeconds?: number;
};

function failure(
  code: string,
  details: Partial<ApiFailure> = {},
): ApiFailure {
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
    .catch(() => ({} as { error?: string; status?: string }));
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
      (await shouldTryAlternateBase(response))
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
  try {
    return await fetch(url, {
      ...options,
      credentials,
      headers: {
        "Content-Type": "application/json",
        "X-HVM-Request": "1",
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

export async function api<T>(
  path: string,
  options: RequestInit = {},
  retried = false,
): Promise<T> {
  const first = await fetchApiPath(path, options, "same-origin");
  let response = first.response;
  const base = first.base;

  if (response.status === 401 && !retried && path === "/v1/auth/session") {
    const sessionFailure = await response
      .clone()
      .json()
      .catch(() => ({} as { error?: string }));

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
      },
    );

  if (json === null)
    throw failure("INVALID_API_RESPONSE", {
      status: response.status,
      requestId,
    });

  return json as T;
}
