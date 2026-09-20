let refreshing: Promise<boolean> | null = null;
export async function api<T>(
  path: string,
  options: RequestInit = {},
  retried = false,
): Promise<T> {
  const response = await fetch("/api" + path, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options.headers },
    signal: options.signal ?? AbortSignal.timeout(10000),
  });
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
  const json = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(json.error ?? "UNAVAILABLE"), {
      status: response.status,
      fields: json.fields,
      requestId: json.requestId,
    });
  return json as T;
}
