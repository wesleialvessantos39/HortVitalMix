import { Capacitor, CapacitorHttp } from "@capacitor/core";

const CANONICAL_BACKEND = "https://hortvitalmix.vercel.app";
const pendingMutations = new Set<Promise<unknown>>();
const pendingSessions = new Set<Promise<unknown>>();

export function isNativeApp() {
  return Capacitor.isNativePlatform() &&
    ["android", "ios"].includes(Capacitor.getPlatform());
}

export function nativeBackendOrigin() {
  if (!isNativeApp()) return null;
  // This value is compiled into the signed application. A query parameter,
  // downloaded manifest or account setting must never select its API server.
  const configured = import.meta.env.VITE_HVM_NATIVE_BACKEND_ORIGIN || CANONICAL_BACKEND;
  let parsed: URL;
  try { parsed = new URL(configured); } catch { throw new Error("NATIVE_BACKEND_INVALID"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
      parsed.port || parsed.search || parsed.hash || parsed.pathname !== "/" ||
      !parsed.hostname.includes(".") || /(?:^|\.)(?:localhost|local|internal)$/.test(parsed.hostname) ||
      /^[\d.]+$/.test(parsed.hostname) || parsed.hostname.includes(":"))
    throw new Error("NATIVE_BACKEND_INVALID");
  return parsed.origin;
}

export function hasPendingNativeMutations() { return pendingMutations.size > 0; }
export function hasPendingNativeSessionChanges() { return pendingSessions.size > 0; }

export async function waitForNativeSessionChanges() {
  // The HTTP plugin does not cancel its native operation when JS is aborted.
  // Wait for its real completion before revoking cookies or changing identity.
  while (pendingSessions.size) await Promise.allSettled([...pendingSessions]);
}

function approvedApiUrl(url: string, origin: string) {
  // URL parsing normalizes encoded dot segments; reject them before parsing.
  if (/%(?:2f|5c|2e)/i.test(url.split(/[?#]/)[0]) || url.includes("\\"))
    throw new Error("NATIVE_API_URL_REJECTED");
  const parsed = new URL(url, origin);
  if (parsed.origin !== origin || parsed.username || parsed.password || parsed.hash ||
      !/^\/api\/(?:v1\/|health(?:$|\?)|ready(?:$|\?))/.test(parsed.pathname) ||
      /%(?:2f|5c|2e)/i.test(parsed.pathname) || parsed.pathname.includes("\\"))
    throw new Error("NATIVE_API_URL_REJECTED");
  return parsed;
}

function publishPendingState() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("hvm:api-mutating"));
}

function awaitWithAbort<T>(operation: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function fetchAppApi(
  url: string,
  options: RequestInit = {},
  binary = false,
): Promise<Response> {
  const origin = nativeBackendOrigin();
  if (!origin) return fetch(url, options);
  const target = approvedApiUrl(url, origin);
  if (options.signal?.aborted)
    throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
  const method = (options.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"].includes(method))
    throw new Error("NATIVE_METHOD_REJECTED");
  const file = options.body instanceof Blob ? options.body : null;
  if (options.body !== undefined && options.body !== null && typeof options.body !== "string" && !file)
    throw new Error("NATIVE_BODY_UNSUPPORTED");
  const headers = new Headers(options.headers);
  // The bridge owns its cookie jar. Keep HttpOnly credentials out of JS and
  // preserve the server's existing strict same-origin mutation validation.
  headers.delete("Cookie");
  headers.delete("Host");
  headers.set("Origin", origin);
  headers.set("X-HVM-Request", "1");
  let data = options.body;
  if (file) {
    if (["GET", "HEAD"].includes(method) || file.size > 32 * 1024 * 1024)
      throw new Error("NATIVE_FILE_SIZE_OR_METHOD_INVALID");
    if (headers.get("Content-Type")?.includes("application/json"))
      throw new Error("NATIVE_FILE_CONTENT_TYPE_INVALID");
    if (!headers.has("Content-Type")) headers.set("Content-Type", file.type || "application/octet-stream");
    headers.delete("Content-Length");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (options.signal?.aborted)
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    // Official native HTTP expects base64 + dataType:file, not a JS Blob.
    // Chunk the conversion to avoid the argument limits of large uploads.
    const parts: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 8192)
      parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
    data = btoa(parts.join(""));
  }
  const sessionRequest = /^\/api\/v1\/(?:admin\/)?auth\//.test(target.pathname);
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(method);
  const native = CapacitorHttp.request({
    url: target.href,
    method,
    headers: Object.fromEntries(headers.entries()),
    ...(data === undefined || data === null ? {} : { data }),
    ...(file ? { dataType: "file" as const } : {}),
    connectTimeout: 20000,
    readTimeout: 20000,
    disableRedirects: true,
    responseType: binary ? "arraybuffer" : "text",
  });
  if (mutation) pendingMutations.add(native);
  if (sessionRequest) pendingSessions.add(native);
  publishPendingState();
  void native.then(() => {}, () => {}).finally(() => {
    pendingMutations.delete(native);
    pendingSessions.delete(native);
    publishPendingState();
  });
  const response = await awaitWithAbort(native, options.signal);
  if (response.url) approvedApiUrl(response.url, origin);
  if (response.status >= 300 && response.status < 400)
    throw new Error("NATIVE_API_REDIRECT_REJECTED");
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("Set-Cookie");
  responseHeaders.delete("Set-Cookie2");
  const empty = method === "HEAD" || [204, 205, 304].includes(response.status);
  let body: BodyInit | null = empty ? null :
    typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? null);
  if (binary && typeof response.data === "string" && !empty &&
      !(responseHeaders.get("content-type") ?? "").includes("json"))
    body = Uint8Array.from(atob(response.data), (char) => char.charCodeAt(0));
  return new Response(body, { status: response.status, headers: responseHeaders });
}
