import type { NextFunction, Request, Response } from "express";
import { supabaseAdmin } from "../supabase/client.ts";
import { resolveIdentityAccess } from "../services/IdentityAccessService.ts";
import { reportFailure } from "../config/reportFailure.ts";

function readCookie(req: Request, name: string) {
  const part = req.headers.cookie
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(name + "="));

  if (!part) return null;

  try {
    return decodeURIComponent(part.slice(name.length + 1));
  } catch {
    return null;
  }
}

function sessionIdFromAccessToken(token: string) {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    ) as { session_id?: unknown };

    return typeof payload.session_id === "string" &&
      /^[0-9a-f-]{36}$/i.test(payload.session_id)
      ? payload.session_id
      : null;
  } catch {
    return null;
  }
}

export async function sessionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.actor = null;

  const authHeader = req.headers.authorization;
  const bearer =
    authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const token = bearer || readCookie(req, "hvm_access");

  if (!token || !supabaseAdmin) {
    next();
    return;
  }

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user || !data.user.email_confirmed_at) {
      next();
      return;
    }

    const sessionId = sessionIdFromAccessToken(token);
    if (!sessionId) {
      next();
      return;
    }

    const access = await resolveIdentityAccess(data.user.id, sessionId);
    if (!access?.liveSession || access.status !== "active") {
      next();
      return;
    }

    req.actor = {
      userId: data.user.id,
      email: data.user.email ?? null,
      roles: access.roles,
      personId: access.personId,
    };

    next();
  } catch {
    reportFailure("session_resolution_failed", res.locals.requestId);
    req.actor = null;
    next();
  }
}
