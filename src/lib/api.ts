let refreshing: Promise<boolean> | null = null;

export type ApiFailure = Error & {
  status?: number;
  fields?: Array<{ field: string; message: string }>;
  requestId?: string;
  currentRevision?: number;
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

function apiBase() {
  if (typeof location === "undefined") return "/api";

  // Em qualquer execução Vite de desenvolvimento (incluindo Google AI Studio),
  // /api pode pertencer ao proxy da plataforma. O prefixo interno é servido
  // pelo mesmo processo Vite/Express e evita o HTTP 403 da camada do Studio.
  return import.meta.env.DEV ? "/_hvm_api" : "/api";
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
      headers: { "Content-Type": "application/json", ...options.headers },
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
  const base = apiBase();
  let response = await doFetch(base + path, options, "same-origin");

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
      },
    );

  if (json === null)
    throw failure("INVALID_API_RESPONSE", {
      status: response.status,
      requestId,
    });

  return json as T;
}
