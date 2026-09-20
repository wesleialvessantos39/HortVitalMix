let refreshing: Promise<boolean> | null = null;

type ApiFailure = Error & {
  status?: number;
  fields?: Array<{ field: string; message: string }>;
  requestId?: string;
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

const PUBLIC_REGISTRATION_API_BASE =
  "https://hortvitalmix.vercel.app/api";

function isPublicRegistrationPath(path: string) {
  return /^\/v1\/auth\/register-(?:consumer|producer)$/.test(path);
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
  let response = await doFetch("/api" + path, options, "same-origin");

  if (response.status === 401 && !retried && path === "/v1/auth/session") {
    refreshing ??= fetch("/api/v1/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
      signal: AbortSignal.timeout(10000),
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
    if (await refreshing) return api<T>(path, options, true);
  }

  if (response.status === 204) return undefined as T;

  let parsed = await parseResponse(response);
  let body = (parsed.json ?? {}) as {
    error?: string;
    fields?: Array<{ field: string; message: string }>;
    requestId?: string;
  };

  if (
    response.status === 403 &&
    !body.error &&
    isPublicRegistrationPath(path)
  ) {
    response = await doFetch(
      PUBLIC_REGISTRATION_API_BASE + path,
      options,
      "omit",
    );
    parsed = await parseResponse(response);
    body = (parsed.json ?? {}) as {
      error?: string;
      fields?: Array<{ field: string; message: string }>;
      requestId?: string;
    };
  }

  const { json, requestId } = parsed;

  if (!response.ok)
    throw failure(
      body.error ??
        (typeof (json as Record<string, unknown>)?.code === "string"
          ? String((json as Record<string, unknown>).code)
          : `HTTP_${response.status}`),
      {
        status: response.status,
        fields: body.fields,
        requestId: body.requestId ?? requestId,
      },
    );

  if (json === null)
    throw failure("INVALID_API_RESPONSE", {
      status: response.status,
      requestId,
    });

  return json as T;
}
