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
  // Google Studio e desenvolvimento local: chamadas internas do app carregam
  // X-HVM-Request e podem vir através de proxies que alteram Sec-Fetch-Site.
  if (
    runtime.appEnv !== "production" &&
    firstHeader(req.headers["x-hvm-request"]) === "1"
  ) {
    return true;
  }

  const origin = requestOrigin(req);

  // Verifica se a origem pertence explicitamente aos ambientes do Google AI Studio
  if (origin && runtime.appEnv !== "production") {
    try {
      const parsedOrigin = new URL(origin);
      if (
        parsedOrigin.protocol === "https:" &&
        (parsedOrigin.hostname.endsWith(".usercontent.goog") ||
          parsedOrigin.hostname.endsWith(".googleusercontent.com") ||
          parsedOrigin.hostname === "aistudio.google.com")
      ) {
        return true;
      }
    } catch {
      // Ignora erro de parsing e segue para validações estritas
    }
  }

  const fetchSite = firstHeader(req.headers["sec-fetch-site"]);
  if (fetchSite === "cross-site") return false;

  if (!origin) {
    // Alguns proxies do Google Studio removem Origin, mas preservam
    // Sec-Fetch-Site. Aceitamos somente navegação same-origin.
    return fetchSite === "same-origin";
  }

  if (runtime.origins.includes(origin)) return true;

  try {
    const parsed = new URL(origin);
    const hostCandidates = [
      firstHeader(req.headers["x-forwarded-host"]),
      firstHeader(req.headers.host),
    ].filter((value): value is string => Boolean(value));

    // Google Studio pode servir http://localhost:3000 por um proxy HTTPS
    // e injetar x-forwarded-proto=https. Se navegador e Host são loopback,
    // continua sendo same-origin local e não deve ser bloqueado.
    if (
      loopback(parsed.hostname) &&
      hostCandidates.some((candidate) => {
        const hostname = hostnameFromHost(candidate);
        return Boolean(hostname && loopback(hostname));
      })
    )
      return parsed.protocol === "http:" || parsed.protocol === "https:";

    // www e o host canônico são o mesmo site. O login vale em qualquer aparelho.
    const sameSite = hostCandidates.some((candidate) => {
      const hostname = hostnameFromHost(candidate);
      if (!hostname) return false;
      return hostname.replace(/^www\./, "") === parsed.hostname.replace(/^www\./, "");
    });
    if (!sameSite) return false;

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
