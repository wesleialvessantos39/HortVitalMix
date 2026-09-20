import type { Request } from "express";
import { runtime } from "../config/runtime.ts";

function firstHeader(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(",")[0]?.trim() || null;
}

function loopback(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function hostnameFromHost(host: string | null) {
  if (!host) return null;
  try {
    return new URL("http://" + host).hostname;
  } catch {
    return null;
  }
}

function requestOrigin(req: Request) {
  const origin = firstHeader(req.headers.origin);
  if (origin) return origin;

  const referer = firstHeader(req.headers.referer);
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function isAllowedRequestOrigin(req: Request) {
  const origin = requestOrigin(req);
  if (!origin) {
    // Alguns proxies do Google Studio removem Origin, mas preservam
    // Sec-Fetch-Site. Aceitamos somente navegação same-origin.
    return firstHeader(req.headers["sec-fetch-site"]) === "same-origin";
  }

  if (runtime.origins.includes(origin)) return true;

  try {
    const parsed = new URL(origin);
    const requestHost =
      firstHeader(req.headers["x-forwarded-host"]) ??
      firstHeader(req.headers.host);
    const requestHostname = hostnameFromHost(requestHost);

    // Google Studio pode servir http://localhost:3000 por um proxy HTTPS
    // e injetar x-forwarded-proto=https. Se navegador e Host são loopback,
    // continua sendo same-origin local e não deve ser bloqueado.
    if (loopback(parsed.hostname) && requestHostname && loopback(requestHostname))
      return parsed.protocol === "http:" || parsed.protocol === "https:";

    if (!requestHost || parsed.host !== requestHost) return false;

    const forwardedProto = firstHeader(req.headers["x-forwarded-proto"]);
    if (forwardedProto && parsed.protocol !== forwardedProto + ":") return false;

    return runtime.appEnv === "development"
      ? parsed.protocol === "http:" || parsed.protocol === "https:"
      : parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function safeRequestOrigin(req: Request) {
  return isAllowedRequestOrigin(req) ? requestOrigin(req) : null;
}
