import { Router, type Request, type Response } from "express";
import {
  LoginSchema,
  RegisterConsumerSchema,
  RegisterProducerSchema,
} from "../../shared/contracts/auth.ts";
import { runtime } from "../config/runtime.ts";
import { supabasePublic, supabaseAdmin } from "../supabase/client.ts";
import { register } from "../services/AuthService.ts";
import { dbPool } from "../db/pool.ts";
import { classifyDbError, reportFailure } from "../config/reportFailure.ts";
export const authRouter = Router();
export function cookie(req: Request, name: string) {
  const part = req.headers.cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + "="));
  try {
    return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
  } catch {
    return null;
  }
}
function clear(res: Response) {
  for (const name of ["hvm_access", "hvm_refresh"])
    res.clearCookie(name, {
      path: "/api",
      httpOnly: true,
      secure: runtime.secureCookies,
      sameSite: "lax",
    });
}
function setSession(
  res: Response,
  data: { access_token: string; refresh_token: string; expires_in: number },
) {
  const opts = {
    httpOnly: true,
    secure: runtime.secureCookies,
    sameSite: "lax" as const,
    path: "/api",
  };
  res.cookie("hvm_access", data.access_token, {
    ...opts,
    maxAge: data.expires_in * 1000,
  });
  res.cookie("hvm_refresh", data.refresh_token, {
    ...opts,
    maxAge: 30 * 86400 * 1000,
  });
}
async function tokenGrant(body: unknown, grant: string) {
  return fetch(runtime.supabaseUrl + "/auth/v1/token?grant_type=" + grant, {
    method: "POST",
    headers: { apikey: runtime.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(7000),
  });
}
authRouter.post("/login", async (req, res, next) => {
  try {
    const input = LoginSchema.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: "VALIDATION_ERROR" });
      return;
    }
    if (!supabasePublic || !dbPool) {
      res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
      return;
    }
    const response = await tokenGrant(input.data, "password");
    if (!response.ok) {
      res
        .status(response.status === 400 ? 401 : 503)
        .json({
          error:
            response.status === 400
              ? "INVALID_CREDENTIALS"
              : "DEPENDENCY_UNAVAILABLE",
        });
      return;
    }
    const data = await response.json();
    const row = await dbPool.query(
      "SELECT status FROM public.app_users WHERE id=$1",
      [data.user.id],
    );
    if (row.rows[0]?.status !== "active") {
      res.status(403).json({ error: "ACCOUNT_UNAVAILABLE" });
      return;
    }
    setSession(res, data);
    res.json({ status: "authenticated" });
  } catch (e) {
    next(e);
  }
});
authRouter.post("/refresh", async (req, res, next) => {
  try {
    const refresh = cookie(req, "hvm_refresh");
    if (!refresh) {
      res.status(401).json({ error: "SESSION_REQUIRED" });
      return;
    }
    if (!supabasePublic || !dbPool) {
      res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
      return;
    }
    const response = await tokenGrant(
      { refresh_token: refresh },
      "refresh_token",
    );
    if (!response.ok) {
      clear(res);
      res.status(401).json({ error: "SESSION_EXPIRED" });
      return;
    }
    const data = await response.json();
    const row = await dbPool.query(
      "SELECT status FROM public.app_users WHERE id=$1",
      [data.user.id],
    );
    if (row.rows[0]?.status !== "active") {
      clear(res);
      res.status(403).json({ error: "ACCOUNT_UNAVAILABLE" });
      return;
    }
    setSession(res, data);
    res.json({ status: "authenticated" });
  } catch (e) {
    next(e);
  }
});
authRouter.get("/session", async (req, res, next) => {
  try {
    if (req.actor) {
      res.json({
        userId: req.actor.userId,
        email: req.actor.email,
        roles: req.actor.roles,
      });
      return;
    }

    const token = cookie(req, "hvm_access");
    if (!token) {
      res.status(401).json({ error: "SESSION_REQUIRED" });
      return;
    }
    if (!supabasePublic || !dbPool) {
      res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
      return;
    }
    const result = await supabasePublic.auth.getUser(token);
    if (result.error || !result.data.user) {
      res.status(401).json({ error: "SESSION_EXPIRED" });
      return;
    }
    const id = result.data.user.id;
    let sessionId: string | undefined;
    try {
      sessionId = JSON.parse(
        Buffer.from(token.split(".")[1], "base64url").toString(),
      ).session_id;
    } catch {}
    if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
      res.status(401).json({ error: "SESSION_EXPIRED" });
      return;
    }
    const liveSession = await dbPool.query(
      "SELECT 1 FROM auth.sessions WHERE id=$1 AND user_id=$2",
      [sessionId, id],
    );
    if (!liveSession.rowCount) {
      res.status(401).json({ error: "SESSION_EXPIRED" });
      return;
    }
    const state = await dbPool.query(
      "SELECT status FROM public.app_users WHERE id=$1",
      [id],
    );
    if (state.rows[0]?.status !== "active") {
      res.status(403).json({ error: "ACCOUNT_UNAVAILABLE" });
      return;
    }
    const roles = await dbPool.query(
      "SELECT role_code FROM public.app_user_role_assignments WHERE user_id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())",
      [id],
    );
    res.json({
      userId: id,
      email: result.data.user.email,
      roles: roles.rows.map((r) => r.role_code),
    });
  } catch (e) {
    next(e);
  }
});
authRouter.post("/logout", async (req, res, next) => {
  try {
    const token = cookie(req, "hvm_access");
    if (token) {
      if (!supabaseAdmin) {
        res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
        return;
      }
      const { error } = await supabaseAdmin.auth.admin.signOut(token, "global");
      if (error && error.status !== 401 && error.status !== 403) {
        res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
        return;
      }
    }
    clear(res);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
for (const role of ["consumer", "producer"] as const)
  authRouter.post("/register-" + role, async (req, res) => {
    const parsed = (
      role === "producer" ? RegisterProducerSchema : RegisterConsumerSchema
    ).safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({
          error: "VALIDATION_ERROR",
          fields: parsed.error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          })),
        });
      return;
    }
    try {
      const result = await register(parsed.data, role, res.locals.requestId);
      res.status(201).json(result);
    } catch (e) {
      const status =
        (e as { status?: number }).status ??
        (classifyDbError(e) === "conflict" ? 409 : 503);
      reportFailure("registration_failed", res.locals.requestId);
      res
        .status(status)
        .json({
          error:
            status === 409 ? "IDENTITY_CONFLICT" : "DEPENDENCY_UNAVAILABLE",
        });
    }
  });
