import { Router, type Request, type Response } from "express";
import {
  LoginSchema,
  RegisterConsumerSchema,
  RegisterProducerSchema,
  RoleScopedEmailRequestSchema,
  RoleScopedPasswordChangeSchema,
  RoleScopedResetPasswordSchema,
  SecurityCodeRequestSchema,
  SessionImportSchema,
  type PortalRole,
} from "../../shared/contracts/auth.ts";
import { runtime } from "../config/runtime.ts";
import {
  createSupabasePublicClient,
  supabaseAdmin,
  supabasePublic,
} from "../supabase/client.ts";
import { register } from "../services/AuthService.ts";
import { dbPool } from "../db/pool.ts";
import { classifyDbError, reportFailure } from "../config/reportFailure.ts";
import { safeRequestOrigin } from "../security/origin.ts";
import {
  consumeRecoveryChallenge,
  consumeSecurityCodeChallenge,
  findActiveIdentityForRole,
  invalidateChallenge,
  issueRecoveryChallenge,
  issueSecurityCodeChallenge,
  recordSecurityCodeFailure,
  validateRecoveryChallenge,
  validateSecurityCodeChallenge,
} from "../services/RoleSecurityService.ts";

export const authRouter = Router();

export function cookie(req: Request, name: string) {
  const part = req.headers.cookie
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(name + "="));

  try {
    return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
  } catch {
    return null;
  }
}

function clear(res: Response) {
  for (const name of ["hvm_access", "hvm_refresh", "hvm_portal_role"])
    res.clearCookie(name, {
      path: "/",
      httpOnly: true,
      secure: runtime.secureCookies,
      sameSite: runtime.secureCookies ? "none" : "lax",
    });
}

function setSession(
  res: Response,
  data: { access_token: string; refresh_token: string; expires_in: number },
  portalRole?: PortalRole | null,
) {
  const opts = {
    httpOnly: true,
    secure: runtime.secureCookies,
    sameSite: runtime.secureCookies ? ("none" as const) : ("lax" as const),
    path: "/",
  };

  res.cookie("hvm_access", data.access_token, {
    ...opts,
    maxAge: Math.max(60, data.expires_in) * 1000,
  });
  res.cookie("hvm_refresh", data.refresh_token, {
    ...opts,
    maxAge: 30 * 86400 * 1000,
  });
  if (portalRole)
    res.cookie("hvm_portal_role", portalRole, {
      ...opts,
      maxAge: 30 * 86400 * 1000,
    });
}

const PUBLIC_APP_ORIGIN = "https://hortvitalmix.vercel.app";

function isLoopbackOrigin(origin: string) {
  try {
    const hostname = new URL(origin).hostname;
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    );
  } catch {
    return false;
  }
}

export function redirectUrl(req: Request, path: string) {
  const requestOrigin = safeRequestOrigin(req);
  const origin =
    requestOrigin && !isLoopbackOrigin(requestOrigin)
      ? requestOrigin
      : PUBLIC_APP_ORIGIN;

  try {
    return new URL(path, origin).toString();
  } catch {
    return null;
  }
}

function sessionIdFromToken(token: string) {
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

async function accountIsActive(userId: string) {
  if (!dbPool) return false;
  const row = await dbPool.query<{ status: string }>(
    "SELECT status FROM public.app_users WHERE id=$1",
    [userId],
  );
  return row.rows[0]?.status === "active";
}

async function activeRoles(userId: string) {
  if (!dbPool) return [] as PortalRole[];
  const rows = await dbPool.query<{ role_code: PortalRole }>(
    "SELECT role_code FROM public.app_user_role_assignments WHERE user_id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) ORDER BY role_code",
    [userId],
  );
  return rows.rows.map((row) => row.role_code);
}

async function hasActiveRole(userId: string, role: PortalRole) {
  const roles = await activeRoles(userId);
  return roles.includes(role);
}

function loginPathForRole(role: PortalRole) {
  if (role === "consumer") return "/entrar/consumidor";
  if (role === "producer") return "/entrar/produtor";
  if (role === "platform_admin") return "/entrar/administrador";
  return "/entrar/super-administrador";
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

    const { email, password, portalRole } = input.data;
    const response = await tokenGrant({ email, password }, "password");
    if (!response.ok) {
      res.status(response.status === 400 ? 401 : 503).json({
        error:
          response.status === 400
            ? "INVALID_CREDENTIALS"
            : "DEPENDENCY_UNAVAILABLE",
      });
      return;
    }

    const data = await response.json();
    if (!data.user?.email_confirmed_at) {
      if (supabaseAdmin && data.access_token)
        await supabaseAdmin.auth.admin
          .signOut(data.access_token, "local")
          .catch(() => undefined);
      res.status(403).json({ error: "EMAIL_CONFIRMATION_REQUIRED" });
      return;
    }

    if (!(await accountIsActive(data.user.id))) {
      res.status(403).json({ error: "ACCOUNT_UNAVAILABLE" });
      return;
    }

    if (!(await hasActiveRole(data.user.id, portalRole))) {
      if (supabaseAdmin && data.access_token)
        await supabaseAdmin.auth.admin
          .signOut(data.access_token, "local")
          .catch(() => undefined);
      res.status(403).json({
        error: "ROLE_NOT_ALLOWED_FOR_PORTAL",
        portalRole,
      });
      return;
    }

    setSession(res, data, portalRole);
    res.json({ status: "authenticated", activeRole: portalRole });
  } catch (error) {
    next(error);
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
    if (
      !data.user?.email_confirmed_at ||
      !(await accountIsActive(data.user.id))
    ) {
      clear(res);
      res.status(403).json({
        error: data.user?.email_confirmed_at
          ? "ACCOUNT_UNAVAILABLE"
          : "EMAIL_CONFIRMATION_REQUIRED",
      });
      return;
    }

    const requestedRole = cookie(req, "hvm_portal_role") as PortalRole | null;
    if (requestedRole && !(await hasActiveRole(data.user.id, requestedRole))) {
      clear(res);
      res.status(403).json({ error: "ROLE_NOT_ALLOWED_FOR_PORTAL" });
      return;
    }

    setSession(res, data, requestedRole);
    res.json({ status: "authenticated", activeRole: requestedRole });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/import-session", async (req, res, next) => {
  try {
    const input = SessionImportSchema.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: "VALIDATION_ERROR" });
      return;
    }

    const client = createSupabasePublicClient();
    if (!client || !dbPool) {
      res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
      return;
    }

    const restored = await client.auth.setSession({
      access_token: input.data.accessToken,
      refresh_token: input.data.refreshToken,
    });

    if (restored.error || !restored.data.session || !restored.data.user) {
      res.status(401).json({ error: "SESSION_IMPORT_FAILED" });
      return;
    }

    if (!restored.data.user.email_confirmed_at) {
      res.status(403).json({ error: "EMAIL_CONFIRMATION_REQUIRED" });
      return;
    }

    const sessionId = sessionIdFromToken(restored.data.session.access_token);
    if (!sessionId) {
      res.status(401).json({ error: "SESSION_IMPORT_FAILED" });
      return;
    }

    const live = await dbPool.query(
      "SELECT 1 FROM auth.sessions WHERE id=$1 AND user_id=$2",
      [sessionId, restored.data.user.id],
    );

    if (
      !live.rowCount ||
      !(await accountIsActive(restored.data.user.id))
    ) {
      res.status(401).json({ error: "SESSION_IMPORT_FAILED" });
      return;
    }

    if (
      input.data.portalRole &&
      !(await hasActiveRole(restored.data.user.id, input.data.portalRole))
    ) {
      await client.auth.signOut({ scope: "local" }).catch(() => undefined);
      res.status(403).json({ error: "ROLE_NOT_ALLOWED_FOR_PORTAL" });
      return;
    }

    setSession(res, restored.data.session, input.data.portalRole ?? null);
    res.json({
      status: "imported",
      activeRole: input.data.portalRole ?? null,
    });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/session", async (req, res, next) => {
  try {
    if (req.actor) {
      const selected = cookie(req, "hvm_portal_role");
      const activeRole =
        selected && req.actor.roles.includes(selected)
          ? selected
          : req.actor.roles[0] ?? null;
      res.json({
        userId: req.actor.userId,
        email: req.actor.email,
        roles: req.actor.roles,
        activeRole,
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
    if (
      result.error ||
      !result.data.user ||
      !result.data.user.email_confirmed_at
    ) {
      res.status(401).json({ error: "SESSION_EXPIRED" });
      return;
    }

    const id = result.data.user.id;
    const sessionId = sessionIdFromToken(token);
    if (!sessionId) {
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

    if (!(await accountIsActive(id))) {
      res.status(403).json({ error: "ACCOUNT_UNAVAILABLE" });
      return;
    }

    const roles = await activeRoles(id);
    const selected = cookie(req, "hvm_portal_role");
    const activeRole =
      selected && roles.includes(selected as PortalRole)
        ? (selected as PortalRole)
        : roles[0] ?? null;
    res.json({
      userId: id,
      email: result.data.user.email,
      roles,
      activeRole,
    });
  } catch (error) {
    next(error);
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
  } catch (error) {
    next(error);
  }
});

authRouter.post("/resend-confirmation", async (req, res) => {
  const input = RoleScopedEmailRequestSchema.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "VALIDATION_ERROR" });
    return;
  }

  const identity = await findActiveIdentityForRole(
    input.data.email,
    input.data.portalRole,
  );

  if (identity && supabasePublic) {
    const target = redirectUrl(
      req,
      `/confirmar-contato?portal=${encodeURIComponent(input.data.portalRole)}`,
    );
    if (target) {
      const { error } = await supabasePublic.auth.resend({
        type: "signup",
        email: input.data.email,
        options: { emailRedirectTo: target },
      });
      if (error)
        reportFailure(
          "confirmation_resend_not_dispatched",
          res.locals.requestId,
        );
    }
  }

  // Resposta invariável evita enumeração de identidade/papel.
  res.status(202).json({ status: "accepted" });
});

authRouter.post("/request-password-reset", async (req, res) => {
  const input = RoleScopedEmailRequestSchema.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "VALIDATION_ERROR" });
    return;
  }

  const identity = await findActiveIdentityForRole(
    input.data.email,
    input.data.portalRole,
  );

  if (!identity || !supabasePublic) {
    res.status(202).json({ status: "accepted" });
    return;
  }

  const challenge = await issueRecoveryChallenge(
    identity.user_id,
    input.data.portalRole,
    res.locals.requestId,
  );

  if (!challenge) {
    res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
    return;
  }

  const target = redirectUrl(
    req,
    `/redefinir-senha?portal=${encodeURIComponent(
      input.data.portalRole,
    )}&flow=${encodeURIComponent(challenge.rawToken)}`,
  );

  if (!target) {
    await invalidateChallenge(challenge.id);
    res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
    return;
  }

  const { error } = await supabasePublic.auth.resetPasswordForEmail(
    input.data.email,
    { redirectTo: target },
  );

  if (error) {
    await invalidateChallenge(challenge.id);
    reportFailure("password_recovery_not_dispatched", res.locals.requestId);
  }

  // Resposta pública deliberadamente idêntica com ou sem papel correspondente.
  res.status(202).json({ status: "accepted" });
});

authRouter.post("/magic-link", async (req, res) => {
  const input = RoleScopedEmailRequestSchema.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "VALIDATION_ERROR" });
    return;
  }

  if (
    input.data.portalRole === "platform_admin" ||
    input.data.portalRole === "platform_super_admin"
  ) {
    res.status(403).json({ error: "ADMIN_MAGIC_LINK_NOT_ALLOWED" });
    return;
  }

  const identity = await findActiveIdentityForRole(
    input.data.email,
    input.data.portalRole,
  );

  if (identity && supabasePublic) {
    const target = redirectUrl(
      req,
      `${loginPathForRole(input.data.portalRole)}?portal=${encodeURIComponent(
        input.data.portalRole,
      )}`,
    );
    if (target) {
      const { error } = await supabasePublic.auth.signInWithOtp({
        email: input.data.email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: target,
        },
      });
      if (error)
        reportFailure("magic_link_not_dispatched", res.locals.requestId);
    }
  }

  res.status(202).json({ status: "accepted" });
});

authRouter.post("/reauthenticate", async (req, res, next) => {
  try {
    if (!req.actor) {
      res.status(401).json({ error: "SESSION_REQUIRED" });
      return;
    }

    const access = cookie(req, "hvm_access");
    const refresh = cookie(req, "hvm_refresh");
    const client = createSupabasePublicClient();
    if (!access || !refresh || !client) {
      res.status(401).json({ error: "SESSION_REQUIRED" });
      return;
    }

    const restored = await client.auth.setSession({
      access_token: access,
      refresh_token: refresh,
    });
    if (restored.error || !restored.data.session) {
      clear(res);
      res.status(401).json({ error: "SESSION_EXPIRED" });
      return;
    }

    setSession(res, restored.data.session);
    const { error } = await client.auth.reauthenticate();
    if (error) {
      reportFailure("reauthentication_not_dispatched", res.locals.requestId);
      res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
      return;
    }

    res.status(202).json({ status: "challenge_sent" });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/reset-password", async (req, res, next) => {
  try {
    const input = NewPasswordSchema.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: "VALIDATION_ERROR" });
      return;
    }

    if (!req.actor) {
      res.status(401).json({ error: "SESSION_REQUIRED" });
      return;
    }

    const access = cookie(req, "hvm_access");
    const refresh = cookie(req, "hvm_refresh");
    const client = createSupabasePublicClient();
    if (!access || !refresh || !client) {
      res.status(401).json({ error: "SESSION_REQUIRED" });
      return;
    }

    const restored = await client.auth.setSession({
      access_token: access,
      refresh_token: refresh,
    });
    if (restored.error) {
      clear(res);
      res.status(401).json({ error: "SESSION_EXPIRED" });
      return;
    }

    const updated = await client.auth.updateUser({
      password: input.data.password,
    });
    if (updated.error) {
      res.status(400).json({ error: "PASSWORD_UPDATE_REJECTED" });
      return;
    }

    await client.auth.signOut({ scope: "global" }).catch(() => undefined);
    clear(res);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

authRouter.post("/change-password", async (req, res, next) => {
  try {
    const input = PasswordChangeSchema.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: "VALIDATION_ERROR" });
      return;
    }

    if (!req.actor) {
      res.status(401).json({ error: "SESSION_REQUIRED" });
      return;
    }

    const access = cookie(req, "hvm_access");
    const refresh = cookie(req, "hvm_refresh");
    const client = createSupabasePublicClient();
    if (!access || !refresh || !client) {
      res.status(401).json({ error: "SESSION_REQUIRED" });
      return;
    }

    const restored = await client.auth.setSession({
      access_token: access,
      refresh_token: refresh,
    });
    if (restored.error) {
      clear(res);
      res.status(401).json({ error: "SESSION_EXPIRED" });
      return;
    }

    const updated = await client.auth.updateUser({
      password: input.data.password,
      nonce: input.data.nonce,
    });

    if (updated.error) {
      res.status(400).json({ error: "SECURITY_CODE_REJECTED" });
      return;
    }

    await client.auth.signOut({ scope: "global" }).catch(() => undefined);
    clear(res);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

for (const role of ["consumer", "producer"] as const)
  authRouter.post("/register-" + role, async (req, res) => {
    const parsed = (
      role === "producer" ? RegisterProducerSchema : RegisterConsumerSchema
    ).safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        requestId: res.locals.requestId,
        fields: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }

    try {
      const result = await register(
        parsed.data,
        role,
        res.locals.requestId,
        redirectUrl(req, "/confirmar-contato") ?? undefined,
      );
      res.status(201).json(result);
    } catch (error) {
      const message = (error as Error)?.message;
      const status =
        (error as { status?: number }).status ??
        (classifyDbError(error) === "conflict" ? 409 : 503);

      const publicCode =
        message === "REGISTRATION_IDENTITY_CONFLICT"
          ? "IDENTITY_CONFLICT"
          : message === "REGISTRATION_ROLE_ALREADY_ASSIGNED"
            ? "ROLE_ALREADY_ASSIGNED"
            : message === "REGISTRATION_CPF_LINKED_TO_EXISTING_ACCOUNT"
              ? "CPF_LINKED_TO_EXISTING_ACCOUNT"
              : message === "REGISTRATION_EXISTING_ACCOUNT_CREDENTIALS_INVALID"
                ? "EXISTING_ACCOUNT_CREDENTIALS_INVALID"
                : message === "REGISTRATION_EXISTING_ACCOUNT_CONFIRM_REQUIRED"
                  ? "EXISTING_ACCOUNT_CONFIRM_REQUIRED"
          : message === "REGISTRATION_RATE_LIMITED"
            ? "REGISTRATION_RATE_LIMITED"
            : message === "REGISTRATION_AUTH_UNAVAILABLE"
              ? "AUTH_UNAVAILABLE"
              : message === "REGISTRATION_DATABASE_UNAVAILABLE"
                ? "DATABASE_UNAVAILABLE"
                : message === "REGISTRATION_SCHEMA_OUTDATED"
                  ? "REGISTRATION_SCHEMA_OUTDATED"
                  : message === "REGISTRATION_DATA_REJECTED"
                    ? "REGISTRATION_DATA_REJECTED"
                    : message === "REGISTRATION_STATUS_UNKNOWN"
                      ? "REGISTRATION_STATUS_UNKNOWN"
                      : message === "REGISTRATION_UNEXPECTED_FAILURE"
                        ? "REGISTRATION_INTERNAL_ERROR"
                        : status === 409
                        ? "IDENTITY_CONFLICT"
                        : "DEPENDENCY_UNAVAILABLE";

      reportFailure({
        category: "registration_failed",
        requestId: res.locals.requestId,
        detail: publicCode,
      });
      res.status(status).json({
        error: publicCode,
        requestId: res.locals.requestId,
      });
    }
  });
