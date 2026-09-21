import type { NextFunction, Request, Response } from "express";
import { supabaseAdmin } from "../supabase/client.ts";
import type { ActorContext } from "../services/ConfigurationService.ts";
import { ConfigErrorCode } from "../../shared/contracts/adminConfig.ts";

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

function resolveSessionIssuedAt(token: string, lastSignInAt?: string | null) {
  // O Manual Mestre Técnico v10 define last_sign_in_at como o proxy canônico
  // da reautenticação recente na Trilha 02. Priorizá-lo evita que um refresh
  // automático do access token "rejuvenesça" indevidamente a janela de 15 min.
  if (lastSignInAt) {
    const parsed = new Date(lastSignInAt).getTime();
    if (Number.isFinite(parsed)) return lastSignInAt;
  }

  // Fallback fail-safe para identidades legadas sem last_sign_in_at.
  // O token já foi validado por supabaseAdmin.auth.getUser acima.
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    ) as { iat?: unknown };
    if (typeof payload.iat === "number" && Number.isFinite(payload.iat))
      return new Date(payload.iat * 1000).toISOString();
  } catch {
    // Timestamp inválido será recusado pelo serviço de reautenticação.
  }

  return new Date(0).toISOString();
}

export async function adminSessionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const token = bearer || readCookie(req, "hvm_access");
  const portalRole = readCookie(req, "hvm_portal_role");

  if (!token) {
    res.status(401).json({
      error: ConfigErrorCode.UNAUTHORIZED,
      message: "Token de sessão administrativa ausente.",
      requestId: req.requestId,
    });
    return;
  }

  if (!supabaseAdmin) {
    res.status(503).json({
      error: "AUTH_UNAVAILABLE",
      requestId: req.requestId,
    });
    return;
  }

  const { data: userData, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !userData.user || !userData.user.email_confirmed_at) {
    res.status(401).json({
      error: ConfigErrorCode.UNAUTHORIZED,
      message: "Sessão inválida ou expirada.",
      requestId: req.requestId,
    });
    return;
  }

  if (!req.actor || req.actor.userId !== userData.user.id) {
    res.status(401).json({
      error: ConfigErrorCode.UNAUTHORIZED,
      message: "Sessão administrativa não está ativa.",
      requestId: req.requestId,
    });
    return;
  }

  const { data: roleRow, error: roleError } = await supabaseAdmin
    .from("app_user_role_assignments")
    .select("role_code, expires_at, revoked_at")
    .eq("user_id", userData.user.id)
    .eq("role_code", "platform_super_admin")
    .is("revoked_at", null)
    .maybeSingle();

  if (roleError || !roleRow) {
    res.status(403).json({
      error: ConfigErrorCode.FORBIDDEN,
      message: "Acesso restrito ao Super Administrador.",
      requestId: req.requestId,
    });
    return;
  }

  if (
    roleRow.expires_at &&
    new Date(roleRow.expires_at).getTime() <= Date.now()
  ) {
    res.status(403).json({
      error: ConfigErrorCode.FORBIDDEN,
      message: "Autorização expirada.",
      requestId: req.requestId,
    });
    return;
  }

  if (!bearer && portalRole !== "platform_super_admin") {
    res.status(403).json({
      error: ConfigErrorCode.FORBIDDEN,
      message: "Use o acesso de Super Administrador.",
      requestId: req.requestId,
    });
    return;
  }

  req.adminActor = {
    userId: userData.user.id,
    role: "platform_super_admin",
    sessionIssuedAt: resolveSessionIssuedAt(
      token,
      userData.user.last_sign_in_at,
    ),
  };
  next();
}
