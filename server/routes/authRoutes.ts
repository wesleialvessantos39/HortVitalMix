// Auth flow: resetPasswordForEmail dispatches before challenge finalization
import { hasConfirmedEmail } from "../../shared/securityCodes.ts";
import { Router, type NextFunction, type Request, type Response } from "express";
import {
  LoginSchema,
  RegisterConsumerSchema,
  RegisterProducerSchema,
  RoleScopedEmailRequestSchema,
  RoleScopedPasswordChangeSchema,
  RoleScopedRecoveryFlowSchema,
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
import { resolveIdentityAccess } from "../services/IdentityAccessService.ts";
import { classifyDbError, reportFailure } from "../config/reportFailure.ts";
import { safeRequestOrigin } from "../security/origin.ts";
import {
  consumeRecoveryChallenge,
  consumeSecurityCodeChallenge,
  finalizeRecoveryChallenge,
  findActiveIdentityForRole,
  invalidateChallenge,
  issueRecoveryChallenge,
  issueSecurityCodeChallenge,
  recordSecurityCodeFailure,
  recoveryRequestCooldown,
  resolveRecoveryChallenge,
  validateSecurityCodeChallenge,
} from "../services/RoleSecurityService.ts";
import { loginRateLimit, resetLoginRateLimit } from "../security/loginRateLimit.ts";
import { authEmailRetryAfter } from "../security/authEmailRateLimit.ts";
import { issueRecentAuthProof, RECENT_AUTH_WINDOW_MS } from "../security/recentAuth.ts";

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
  for (const name of ["hvm_access", "hvm_refresh", "hvm_portal_role", "hvm_reauth"])
    res.clearCookie(name, {
      path: "/",
      httpOnly: true,
      secure: runtime.secureCookies,
      sameSite: "lax",
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
    sameSite: "lax" as const,
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

function setRecentAuth(
  res: Response,
  userId: string,
  accessToken: string,
) {
  const proof = issueRecentAuthProof(userId, accessToken);
  res.cookie("hvm_reauth", proof, {
    httpOnly: true,
    secure: runtime.secureCookies,
    sameSite: "strict",
    path: "/",
    maxAge: RECENT_AUTH_WINDOW_MS,
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

function loginPathForRole(role: PortalRole) {
  if (role === "consumer") return "/entrar/consumidor";
  if (role === "producer") return "/entrar/produtor";
  if (role === "platform_admin") return "/entrar/administrador";
  return "/entrar/super-administrador";
}

function portalKindForRole(role: string | null | undefined) {
  return role === "platform_admin" || role === "platform_super_admin"
    ? "administrative"
    : "public";
}

async function tokenGrant(body: unknown, grant: string) {
  return fetch(runtime.supabaseUrl + "/auth/v1/token?grant_type=" + grant, {
    method: "POST",
    headers: { apikey: runtime.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(7000),
  });
}

async function handlePublicLoginRequest(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const startedAt = Date.now();
  try {
    const input = LoginSchema.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        fields: input.error.issues.map((issue) => ({
          field: String(issue.path[0] ?? "request"),
          message: issue.message,
        })),
        requestId: res.locals.requestId,
      });
      return;
    }

    const { email, password, portalRole } = input.data;
    const administrativeRole =
      portalRole === "platform_admin" || portalRole === "platform_super_admin";

    if (administrativeRole) {
      res.status(403).json({
        error: "ADMIN_GOVERNANCE_LOGIN_REQUIRED",
        redirectTo: "/admin/entrar",
      });
      return;
    }
    if (!supabasePublic) {
      res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
      return;
    }

    const response = await tokenGrant({ email, password }, "password");
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      if (failure.error_code === "email_not_confirmed" || failure.code === "email_not_confirmed") {
        clear(res);
        res.status(403).json({ error: "EMAIL_CONFIRMATION_REQUIRED" });
        return;
      }
      res.status(response.status === 400 ? 401 : 503).json({
        error: response.status === 400 ? "INVALID_CREDENTIALS" : "DEPENDENCY_UNAVAILABLE",
      });
      return;
    }

    const data = await response.json();
    if (!hasConfirmedEmail(data.user)) {
      if (supabaseAdmin && data.access_token)
        await supabaseAdmin.auth.admin.signOut(data.access_token, "local").catch(() => undefined);
      clear(res);
      res.status(403).json({ error: "EMAIL_CONFIRMATION_REQUIRED" });
      return;
    }
    const access = await resolveIdentityAccess(
      data.user.id,
      null,
      data.access_token,
    );
    if (!access) {
      if (supabaseAdmin && data.access_token)
        await supabaseAdmin.auth.admin.signOut(data.access_token, "local").catch(() => undefined);
      res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
      return;
    }
    if (access.status !== "active") {
      if (supabaseAdmin && data.access_token)
        await supabaseAdmin.auth.admin.signOut(data.access_token, "local").catch(() => undefined);
      res.status(403).json({ error: "ACCOUNT_UNAVAILABLE" });
      return;
    }
    if (!access.roles.includes(portalRole)) {
      if (supabaseAdmin && data.access_token)
        await supabaseAdmin.auth.admin.signOut(data.access_token, "local").catch(() => undefined);
      res.status(403).json({ error: "ROLE_NOT_ALLOWED_FOR_PORTAL", portalRole });
      return;
    }

    setSession(res, data, portalRole);
    setRecentAuth(res, data.user.id, data.access_token);
    resetLoginRateLimit(req.clientIpHash);
    res.setHeader("Server-Timing", "auth-login;dur=" + Math.max(0, Date.now() - startedAt));
    res.json({
      status: "authenticated",
      userId: data.user.id,
      email: data.user.email ?? null,
      roles: access.roles,
      activeRole: portalRole,
      portalKind: portalKindForRole(portalRole),
    });
  } catch (error) {
    next(error);
  }
}

authRouter.post("/login", loginRateLimit, (req, res, next) => {
  void handlePublicLoginRequest(req, res, next);
});

// Compatibilidade defensiva: o endpoint legado nunca autentica papéis administrativos.
// Todo acesso administrativo passa pela governança T05 (/v1/admin/auth/login),
// garantindo MFA obrigatório antes da sessão do Super administrador.
authRouter.post("/admin-login", (_req, res) => {
  res.status(409).json({
    error: "ADMIN_GOVERNANCE_LOGIN_REQUIRED",
    redirectTo: "/admin/entrar",
  });
});

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const refresh = cookie(req, "hvm_refresh");
    if (!refresh) {
      res.status(401).json({ error: "SESSION_REQUIRED" });
      return;
    }

    if (!supabasePublic) {
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
    if (!hasConfirmedEmail(data.user)) {
      clear(res);
      clear(res);
      res.status(403).json({ error: "EMAIL_CONFIRMATION_REQUIRED" });
      return;
    }

    const access = await resolveIdentityAccess(
      data.user.id,
      null,
      data.access_token,
    );
    if (!access) {
      res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
      return;
    }
    if (access.status !== "active") {
      clear(res);
      res.status(403).json({ error: "ACCOUNT_UNAVAILABLE" });
      return;
    }

    const requestedRole = cookie(req, "hvm_portal_role") as PortalRole | null;
    if (requestedRole && !access.roles.includes(requestedRole)) {
      clear(res);
      res.status(403).json({ error: "ROLE_NOT_ALLOWED_FOR_PORTAL" });
      return;
    }

    setSession(res, data, requestedRole);
    res.json({
      status: "authenticated",
      userId: data.user.id,
      email: data.user.email ?? null,
      roles: access.roles,
      activeRole: requestedRole,
      portalKind: portalKindForRole(requestedRole),
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/import-session", async (req, res, next) => {
  try {
    const input = SessionImportSchema.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        fields: input.error.issues.map((issue) => ({
          field: String(issue.path[0] ?? "request"),
          message: issue.message,
        })),
        requestId: res.locals.requestId,
      });
      return;
    }

    if (input.data.portalRole === "platform_admin" || input.data.portalRole === "platform_super_admin") {
      res.status(403).json({ error: "ADMIN_GOVERNANCE_LOGIN_REQUIRED" });
      return;
    }
    const client = createSupabasePublicClient();
    if (!client) {
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

    if (!hasConfirmedEmail(restored.data.user)) {
      clear(res);
      res.status(403).json({ error: "EMAIL_CONFIRMATION_REQUIRED" });
      return;
    }

    const sessionId = sessionIdFromToken(restored.data.session.access_token);
    if (!sessionId) {
      res.status(401).json({ error: "SESSION_IMPORT_FAILED" });
      return;
    }

    const access = await resolveIdentityAccess(
      restored.data.user.id,
      sessionId,
      restored.data.session.access_token,
    );
    if (access && !access.roles.some((role) => role === "consumer" || role === "producer")) {
      await client.auth.signOut({ scope: "local" }).catch(() => undefined);
      res.status(403).json({ error: "ADMIN_GOVERNANCE_LOGIN_REQUIRED" });
      return;
    }
    if (!access?.liveSession || access.status !== "active") {
      res.status(401).json({ error: "SESSION_IMPORT_FAILED" });
      return;
    }

    if (
      input.data.portalRole &&
      !access.roles.includes(input.data.portalRole)
    ) {
      await client.auth.signOut({ scope: "local" }).catch(() => undefined);
      res.status(403).json({ error: "ROLE_NOT_ALLOWED_FOR_PORTAL" });
      return;
    }

    setSession(res, restored.data.session, input.data.portalRole ?? null);
    res.json({
      status: "imported",
      userId: restored.data.user.id,
      email: restored.data.user.email ?? null,
      roles: access.roles,
      activeRole: input.data.portalRole ?? null,
      portalKind: portalKindForRole(input.data.portalRole ?? null),
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
        portalKind: portalKindForRole(activeRole),
      });
      return;
    }

    const token = cookie(req, "hvm_access");
    if (!token) {
      res.status(401).json({ error: "SESSION_REQUIRED" });
      return;
    }

    if (!supabasePublic) {
      res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
      return;
    }

    const result = await supabasePublic.auth.getUser(token);
    if (
      result.error ||
      !result.data.user ||
      !hasConfirmedEmail(result.data.user)
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

    const access = await resolveIdentityAccess(id, sessionId, token);
    if (!access?.liveSession) {
      res.status(401).json({ error: "SESSION_EXPIRED" });
      return;
    }
    if (access.status !== "active") {
      res.status(403).json({ error: "ACCOUNT_UNAVAILABLE" });
      return;
    }

    const selected = cookie(req, "hvm_portal_role");
    const activeRole =
      selected && access.roles.includes(selected as PortalRole)
        ? (selected as PortalRole)
        : access.roles[0] ?? null;
    res.json({
      userId: id,
      email: result.data.user.email,
      roles: access.roles,
      activeRole,
      portalKind: portalKindForRole(activeRole),
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
    res.status(400).json({
        error: "VALIDATION_ERROR",
        fields: input.error.issues.map((issue) => ({
          field: String(issue.path[0] ?? "request"),
          message: issue.message,
        })),
        requestId: res.locals.requestId,
      });
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
    res.status(400).json({
        error: "VALIDATION_ERROR",
        fields: input.error.issues.map((issue) => ({
          field: String(issue.path[0] ?? "request"),
          message: issue.message,
        })),
        requestId: res.locals.requestId,
      });
    return;
  }

  const identity = await findActiveIdentityForRole(
    input.data.email,
    input.data.portalRole,
  );

  if (!identity || !supabasePublic) {
    res.status(202).json({ status: "accepted", retryAfterSeconds: 60 });
    return;
  }

  // Não invalida um link entregue antes de sabermos que um novo e-mail foi
  // realmente aceito pelo provedor. Isso evita deixar o usuário sem nenhum
  // caminho válido quando o Supabase aplica cooldown de envio.
  const cooldown = await recoveryRequestCooldown(
    identity.user_id,
    input.data.portalRole,
  );
  if (cooldown > 0) {
    res.status(202).json({
      status: "accepted",
      retryAfterSeconds: cooldown,
    });
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
    const retryAfterSeconds = authEmailRetryAfter(error);
    reportFailure(
      retryAfterSeconds
        ? "password_recovery_email_rate_limited"
        : "password_recovery_not_dispatched",
      res.locals.requestId,
    );
    // Resposta anti-enumeração: não revela se a identidade existe.
    res.status(202).json({
      status: "accepted",
      retryAfterSeconds: retryAfterSeconds ?? 60,
    });
    return;
  }

  await finalizeRecoveryChallenge(
    identity.user_id,
    input.data.portalRole,
    challenge.id,
  );

  res.status(202).json({ status: "accepted", retryAfterSeconds: 60 });
});

authRouter.post("/password/recovery/validate", async (req, res) => {
  const input = RoleScopedRecoveryFlowSchema.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({
        error: "VALIDATION_ERROR",
        fields: input.error.issues.map((issue) => ({
          field: String(issue.path[0] ?? "request"),
          message: issue.message,
        })),
        requestId: res.locals.requestId,
      });
    return;
  }

  const challenge = await resolveRecoveryChallenge(
    input.data.portalRole,
    input.data.flowToken,
  );
  if (!challenge) {
    res.status(410).json({ status: "invalid" });
    return;
  }

  res.status(200).json({ status: "valid" });
});

authRouter.post("/magic-link", async (req, res) => {
  const input = RoleScopedEmailRequestSchema.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({
        error: "VALIDATION_ERROR",
        fields: input.error.issues.map((issue) => ({
          field: String(issue.path[0] ?? "request"),
          message: issue.message,
        })),
        requestId: res.locals.requestId,
      });
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
    const input = SecurityCodeRequestSchema.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        fields: input.error.issues.map((issue) => ({
          field: String(issue.path[0] ?? "request"),
          message: issue.message,
        })),
        requestId: res.locals.requestId,
      });
      return;
    }

    if (!req.actor) {
      res.status(401).json({ error: "SESSION_REQUIRED" });
      return;
    }

    const selectedRole = cookie(req, "hvm_portal_role") as PortalRole | null;
    if (
      selectedRole !== input.data.portalRole ||
      !req.actor.roles.includes(input.data.portalRole)
    ) {
      res.status(403).json({ error: "SECURITY_CONTEXT_MISMATCH" });
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

    const challenge = await issueSecurityCodeChallenge(
      req.actor.userId,
      input.data.portalRole,
      res.locals.requestId,
    );
    if (!challenge) {
      res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
      return;
    }

    setSession(res, restored.data.session, input.data.portalRole);
    const { error } = await client.auth.reauthenticate();
    if (error) {
      await invalidateChallenge(challenge.id);
      reportFailure("reauthentication_not_dispatched", res.locals.requestId);
      res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
      return;
    }

    res.status(202).json({
      status: "challenge_sent",
      challengeId: challenge.id,
      portalRole: input.data.portalRole,
      expiresAt: challenge.expiresAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/reset-password", async (req, res, next) => {
  try {
    const input = RoleScopedResetPasswordSchema.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        fields: input.error.issues.map((issue) => ({
          field: String(issue.path[0] ?? "request"),
          message: issue.message,
        })),
        requestId: res.locals.requestId,
      });
      return;
    }
    if (!supabaseAdmin) {
      res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
      return;
    }

    // O token HortiVitalMix é a autorização canônica da recuperação: 32 bytes
    // aleatórios, digest-only no banco, curto, single-use e entregue somente no
    // e-mail de recovery. Não depende de uma sessão já importada do fragmento URL.
    const challenge = await resolveRecoveryChallenge(
      input.data.portalRole,
      input.data.flowToken,
    );
    if (!challenge) {
      res.status(410).json({ error: "RECOVERY_CONTEXT_INVALID" });
      return;
    }

    const updated = await supabaseAdmin.auth.admin.updateUserById(
      challenge.userId,
      { password: input.data.password },
    );
    if (updated.error) {
      reportFailure("password_update_rejected", res.locals.requestId);
      res.status(400).json({ error: "PASSWORD_UPDATE_REJECTED" });
      return;
    }

    let sessionsRevoked = false;
    const revoked = await supabaseAdmin.rpc("fn_revoke_auth_sessions", {
      p_user_id: challenge.userId,
    });
    sessionsRevoked = !revoked.error;

    if (!sessionsRevoked && dbPool) {
      try {
        await dbPool.query("DELETE FROM auth.sessions WHERE user_id=$1", [
          challenge.userId,
        ]);
        sessionsRevoked = true;
      } catch {
        sessionsRevoked = false;
      }
    }

    if (!sessionsRevoked) {
      reportFailure("password_sessions_revoke_failed", res.locals.requestId);
      res.status(503).json({ error: "SESSION_REVOCATION_FAILED" });
      return;
    }

    const consumed = await consumeRecoveryChallenge(
      challenge.userId,
      input.data.portalRole,
      input.data.flowToken,
    );
    if (!consumed) {
      clear(res);
      res.status(409).json({ error: "RECOVERY_CONTEXT_ALREADY_USED" });
      return;
    }

    await supabaseAdmin
      .from("app_audit_events")
      .insert({
        request_id: res.locals.requestId,
        actor_id: challenge.userId,
        actor_role: "anonymous",
        action: "password.reset.completed",
        target_entity: "app_role_security_challenges",
        target_id: challenge.id,
        client_ip_hash: req.clientIpHash,
      })
      .then(({ error }) => {
        if (error)
          reportFailure("password_reset_audit_failed", res.locals.requestId);
      });

    clear(res);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

authRouter.post("/change-password", async (req, res, next) => {
  try {
    const input = RoleScopedPasswordChangeSchema.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        fields: input.error.issues.map((issue) => ({
          field: String(issue.path[0] ?? "request"),
          message: issue.message,
        })),
        requestId: res.locals.requestId,
      });
      return;
    }

    if (!req.actor) {
      res.status(401).json({ error: "SESSION_REQUIRED" });
      return;
    }

    const selectedRole = cookie(req, "hvm_portal_role") as PortalRole | null;
    if (
      selectedRole !== input.data.portalRole ||
      !req.actor.roles.includes(input.data.portalRole)
    ) {
      res.status(403).json({ error: "SECURITY_CONTEXT_MISMATCH" });
      return;
    }

    const validChallenge = await validateSecurityCodeChallenge(
      input.data.challengeId,
      req.actor.userId,
      input.data.portalRole,
    );
    if (!validChallenge) {
      res.status(410).json({ error: "SECURITY_CODE_CONTEXT_INVALID" });
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
      await recordSecurityCodeFailure(input.data.challengeId);
      res.status(400).json({ error: "SECURITY_CODE_REJECTED" });
      return;
    }

    await consumeSecurityCodeChallenge(input.data.challengeId);
    await client.auth.signOut({ scope: "global" }).catch(() => undefined);
    clear(res);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

for (const role of ["consumer", "producer"] as const)
  authRouter.post("/register-" + role, async (req, res) => {
    const startedAt = Date.now();
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
      );
      // A previous browser session is not proof that this new account was confirmed.
      clear(res);
      let confirmationDispatchAccepted = Boolean(
        result.confirmationDispatchAccepted,
      );
      if (
        result.confirmationRequired &&
        !confirmationDispatchAccepted &&
        supabasePublic
      ) {
        const target = redirectUrl(req, `/confirmar-contato?portal=${role}`);
        if (target) {
          try {
            const sent = await supabasePublic.auth.resend({
              type: "signup",
              email: parsed.data.email,
              options: { emailRedirectTo: target },
            });
            confirmationDispatchAccepted = !sent.error;
          } catch {
            reportFailure("registration_confirmation_not_dispatched", res.locals.requestId);
          }
        }
      }
      res.setHeader("Server-Timing", "auth-register;dur=" + Math.max(0, Date.now() - startedAt));
      res.status(201).json({
        ...result,
        confirmationDispatchAccepted,
        confirmationDispatchDeferred: result.confirmationRequired && !confirmationDispatchAccepted,
      });
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

