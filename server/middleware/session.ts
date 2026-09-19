import type { NextFunction, Request, Response } from "express";
import { dbPool } from "../db/pool.ts";
import { supabaseAdmin } from "../supabase/client.ts";
import { reportFailure } from "../config/reportFailure.ts";

export async function sessionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.actor = null;

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    next();
    return;
  }

  if (!supabaseAdmin || !dbPool) {
    next();
    return;
  }

  try {
    const token = authHeader.slice(7).trim();
    if (!token) {
      next();
      return;
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) {
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
