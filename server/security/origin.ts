import type { Request } from "express";
import { runtime } from "../config/runtime.ts";

function firstHeader(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(",")[0]?.trim() || null;
}

export function isAllowedRequestOrigin(req: Request) {
  const origin = firstHeader(req.headers.origin);
  if (!origin) return false;

  if (runtime.origins.includes(origin)) return true;

  try {
    const parsed = new URL(origin);
    const requestHost =
      firstHeader(req.headers.host) ??
      firstHeader(req.headers["x-forwarded-host"]);
    if (!requestHost || parsed.host !== requestHost) return false;

    const forwardedProto = firstHeader(req.headers["x-forwarded-proto"]);
    if (forwardedProto) return parsed.protocol === forwardedProto + ":";

    if (runtime.appEnv === "development")
      return parsed.protocol === "http:" || parsed.protocol === "https:";

    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function safeRequestOrigin(req: Request) {
  return isAllowedRequestOrigin(req)
    ? firstHeader(req.headers.origin)
    : null;
}
