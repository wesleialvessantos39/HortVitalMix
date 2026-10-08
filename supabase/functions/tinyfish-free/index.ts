import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

// HortVitalMix: TinyFish Search / Fetch only. No paid Agent/Browser endpoints.
// The TinyFish API key is a server-side Supabase Edge Function secret.
const APP_ORIGIN = "https://hortvitalmix.vercel.app";
const MAX_BODY_BYTES = 12_288;
const MAX_UPSTREAM_BYTES = 700_000;
const SEARCH_API = "https://api.search.tinyfish.ai/";
const FETCH_API = "https://api.fetch.tinyfish.ai/";

function isAllowedOrigin(origin: string | null) {
  if (!origin) return true; // non-browser clients
  if (origin === APP_ORIGIN) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      (url.port === "3000" || url.port === "5173");
  } catch {
    return false;
  }
}

function response(status: number, payload: unknown, origin: string | null) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "vary": "Origin",
      ...(origin && isAllowedOrigin(origin)
        ? { "access-control-allow-origin": origin } : {}),
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "authorization,apikey,content-type,x-client-info",
      "access-control-max-age": "600",
    },
  });
}

function safePublicHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
        parsed.port || parsed.hash) return false;
    const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (!host.includes(".") || host === "localhost" ||
        /\.(?:localhost|local|internal|test|invalid|onion)$/.test(host)) return false;
    // Reject IP-literal URLs, including RFC1918, loopback and IPv6.
    if (host.includes(":") || /^[0-9.]+$/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function namedKey(map: string | undefined) {
  if (!map) return "";
  try {
    const parsed = JSON.parse(map) as Record<string, unknown>;
    return typeof parsed.default === "string" ? parsed.default : "";
  } catch {
    return "";
  }
}

async function isSuperAdmin(jwt: string) {
  const baseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const pubKey = Deno.env.get("SUPABASE_ANON_KEY") ??
    namedKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"));
  const secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    namedKey(Deno.env.get("SUPABASE_SECRET_KEYS"));
  if (!baseUrl || !pubKey || !secretKey) return false;

  const client = createClient(baseUrl, pubKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await client.auth.getUser(jwt);
  if (authError || !auth.user?.id || auth.user.is_anonymous) return false;

  const admin = createClient(baseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [principal, assignment, account] = await Promise.all([
    admin.from("app_admin_principals")
      .select("portal_role")
      .eq("admin_user_id", auth.user.id)
      .eq("portal_role", "platform_super_admin")
      .maybeSingle(),
    admin.from("app_user_role_assignments")
      .select("role_code,expires_at")
      .eq("user_id", auth.user.id)
      .eq("role_code", "platform_super_admin")
      .is("revoked_at", null),
    admin.from("app_users")
      .select("status,blocked_at")
      .eq("id", auth.user.id)
      .maybeSingle(),
  ]);

  if (principal.error || assignment.error || account.error) return false;
  const roles = assignment.data ?? [];
  return principal.data?.portal_role === "platform_super_admin" &&
    account.data?.status === "active" &&
    !account.data?.blocked_at &&
    roles.some((r) => !r.expires_at || Date.parse(r.expires_at) > Date.now());
}

Deno.serve(async (request) => {
  const id = crypto.randomUUID();
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin))
    return response(403, { error: "ORIGIN_DENIED", requestId: id }, null);

  if (request.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": origin ?? APP_ORIGIN,
        "access-control-allow-methods": "POST,OPTIONS",
        "access-control-allow-headers": "authorization,apikey,content-type,x-client-info",
        "access-control-max-age": "600",
      },
    });
  if (request.method !== "POST")
    return response(405, { error: "METHOD_NOT_ALLOWED", requestId: id }, origin);

  const bearer = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(bearer)?.[1];
  if (!token)
    return response(401, { error: "AUTH_REQUIRED", requestId: id }, origin);

  try {
    if (!await isSuperAdmin(token))
      return response(403, { error: "SUPER_ADMIN_REQUIRED", requestId: id }, origin);
  } catch {
    return response(503, { error: "AUTH_UNAVAILABLE", requestId: id }, origin);
  }

  // A status probe makes no TinyFish requests and incurs no TinyFish usage.
  const apiKey = Deno.env.get("TINYFISH_API_KEY")?.trim() ?? "";
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES)
    return response(413, { error: "PAYLOAD_TOO_LARGE", requestId: id }, origin);

  let input: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw Error("size");
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("shape");
    input = body as Record<string, unknown>;
  } catch {
    return response(400, { error: "INVALID_BODY", requestId: id }, origin);
  }

  if (input.operation === "status")
    return response(200, { connected: Boolean(apiKey), freeApisOnly: true, requestId: id }, origin);
  if (input.operation !== "search" && input.operation !== "fetch")
    return response(400, { error: "OPERATION_NOT_ALLOWED", requestId: id }, origin);
  if (!apiKey)
    return response(503, { error: "TINYFISH_KEY_NOT_CONFIGURED", requestId: id }, origin);

  let url: string;
  let method: string;
  let payload: string | undefined;
  let timeout: number;
  if (input.operation === "search") {
    if (typeof input.query !== "string" || input.query.trim().length < 2 ||
        input.query.length > 300)
      return response(400, { error: "INVALID_QUERY", requestId: id }, origin);
    url = SEARCH_API + "?query=" + encodeURIComponent(input.query.trim());
    method = "GET";
    timeout = 10_000;
  } else {
    if (!Array.isArray(input.urls) || input.urls.length < 1 ||
        input.urls.length > 3 || !input.urls.every(safePublicHttpsUrl))
      return response(400, { error: "INVALID_URLS", requestId: id }, origin);
    url = FETCH_API;
    method = "POST";
    payload = JSON.stringify({ urls: input.urls });
    timeout = 30_000;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const upstream = await fetch(url, {
      method,
      headers: {
        "X-API-Key": apiKey,
        "Accept": "application/json",
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      ...(payload ? { body: payload } : {}),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      const code = upstream.status === 429 ? 429 :
        upstream.status === 401 || upstream.status === 403 ? 502 : 502;
      return response(code, {
        error: upstream.status === 429 ? "TINYFISH_RATE_LIMITED" : "TINYFISH_UPSTREAM_ERROR",
        upstreamStatus: upstream.status, requestId: id,
      }, origin);
    }
    const content = await upstream.text();
    if (new TextEncoder().encode(content).byteLength > MAX_UPSTREAM_BYTES)
      return response(502, { error: "TINYFISH_RESPONSE_TOO_LARGE", requestId: id }, origin);
    let data: unknown;
    try { data = JSON.parse(content); } catch {
      return response(502, { error: "TINYFISH_INVALID_RESPONSE", requestId: id }, origin);
    }
    return response(200, { data, requestId: id }, origin);
  } catch {
    return response(504, { error: "TINYFISH_UNAVAILABLE", requestId: id }, origin);
  } finally {
    clearTimeout(timeoutId);
  }
});
