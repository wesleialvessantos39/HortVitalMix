import type { NextFunction, Request, Response } from "express";
import { dbPool } from "../db/pool.ts";
import { supabaseAdmin } from "../supabase/client.ts";
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

  if (!token || !supabaseAdmin || !dbPool) {
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

    const liveSession = await dbPool.query(
      "SELECT 1 FROM auth.sessions WHERE id=$1 AND user_id=$2",
      [sessionId, data.user.id],
    );
    if (!liveSession.rowCount) {
      next();
      return;
    }

    const account = await dbPool.query<{ status: string }>(
      "SELECT status FROM public.app_users WHERE id=$1",
      [data.user.id],
    );

    if (account.rows[0]?.status !== "active") {
      next();
      return;
    }

    const roles = await dbPool.query<{ role_code: string }>(
      `SELECT role_code
         FROM public.app_user_role_assignments
        WHERE user_id=$1
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())
        ORDER BY role_code`,
      [data.user.id],
    );

    const person = await dbPool.query<{ id: string }>(
      "SELECT id FROM public.app_people WHERE user_id=$1 LIMIT 1",
      [data.user.id],
    );

    req.actor = {
      userId: data.user.id,
      email: data.user.email ?? null,
      roles: roles.rows.map((row) => row.role_code),
      personId: person.rows[0]?.id ?? null,
    };

    next();
  } catch {
    reportFailure("session_resolution_failed", res.locals.requestId);
    req.actor = null;
    next();
  }
}
