import { hasConfirmedEmail } from "../../shared/securityCodes.ts";
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

function isPublicAuthFastPath(path: string): boolean {
  return /^\/(?:api\/)?v1\/auth\/(?:login|admin-login|register-consumer|register-producer|refresh|import-session|resend-confirmation|request-password-reset|reset-password|magic-link|contact\/confirm-token|password\/recovery|password\/reset)$/.test(
    path,
  );
}

export async function sessionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.actor = null;

  // Login/cadastro não dependem de uma sessão anterior. Ignorar cookies antigos
  // aqui evita uma validação Auth + banco antes do próprio request solicitado.
  if (isPublicAuthFastPath(req.path)) {
    next();
    return;
  }

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
    if (error || !data.user || !hasConfirmedEmail(data.user)) {
      next();
      return;
    }

    const sessionId = sessionIdFromAccessToken(token);
    if (!sessionId) {
      next();
      return;
    }

    const access = await resolveIdentityAccess(data.user.id, sessionId, token);
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

