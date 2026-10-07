import type { Request } from "express";
import { CommerceError } from "../services/CommerceSupport.ts";

/** The selected portal never grants a role: membership comes from the live session. */
export function publicRole(req: Request): "consumer" | "producer" {
  if (!req.actor) throw new CommerceError("AUTH_REQUIRED", 401);
  const cookie = req.headers.cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("hvm_portal_role="));
  let selected: string | undefined;
  try {
    selected = cookie
      ? decodeURIComponent(cookie.slice("hvm_portal_role=".length))
      : undefined;
  } catch {
    throw new CommerceError("FORBIDDEN", 403);
  }
  const role = selected ?? req.actor.roles[0];
  if (
    (role !== "consumer" && role !== "producer") ||
    !req.actor.roles.includes(role)
  )
    throw new CommerceError("FORBIDDEN", 403);
  return role;
}

export function publicUser(req: Request, required?: "consumer" | "producer") {
  const role = publicRole(req);
  if (required && role !== required)
    throw new CommerceError(
      required === "consumer" ? "CONSUMER_REQUIRED" : "PRODUCER_REQUIRED",
      403,
    );
  return req.actor!.userId;
}
