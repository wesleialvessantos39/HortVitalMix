import type { NextFunction, Request, Response } from "express";
import { supabaseAdmin } from "../supabase/client.ts";
import type {
  AdminRole,
  AdminSectorCode,
} from "../../shared/contracts/adminGovernance.ts";
import { AdminErrorCode } from "../../shared/contracts/adminGovernance.ts";

export interface AdminActorContext {
  userId: string;
  role: AdminRole;
  sectors: AdminSectorCode[];
  isSuperAdmin: boolean;
  sessionIssuedAt: string;
}

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
  if (lastSignInAt) {
    const parsed = new Date(lastSignInAt).getTime();
    if (Number.isFinite(parsed)) return lastSignInAt;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    ) as { iat?: unknown };
    if (typeof payload.iat === "number" && Number.isFinite(payload.iat))
      return new Date(payload.iat * 1000).toISOString();
  } catch {}
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
      error: AdminErrorCode.UNAUTHORIZED,
      message: "Token de sessão administrativa ausente.",
      requestId: req.requestId,
    });
    return;
  }
  if (!supabaseAdmin) {
    res.status(503).json({ error: AdminErrorCode.UNAVAILABLE, requestId: req.requestId });
    return;
  }

  const { data: userData, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !userData.user || !userData.user.email_confirmed_at) {
    res.status(401).json({
      error: AdminErrorCode.UNAUTHORIZED,
      message: "Sessão inválida ou expirada.",
      requestId: req.requestId,
    });
    return;
  }
  // Não dependa de req.actor do middleware público. Uma credencial
  // administrativa pode apontar para a mesma pessoa/CPF de uma conta pública,
  // mas ter outro auth user_id e outra senha. A fronteira administrativa
  // valida sua própria identidade pelo token + app_admin_principals.
  const principal = await supabaseAdmin
    .from("app_admin_principals")
    .select("admin_user_id,portal_role")
    .eq("admin_user_id", userData.user.id)
    .maybeSingle();

  if (
    principal.error ||
    !principal.data ||
    principal.data.admin_user_id !== userData.user.id
  ) {
    res.status(401).json({
      error: AdminErrorCode.UNAUTHORIZED,
      message: "Sessão administrativa não está ativa.",
      requestId: req.requestId,
    });
    return;
  }

  const roles = await supabaseAdmin
    .from("app_user_role_assignments")
    .select("role_code,expires_at,revoked_at")
    .eq("user_id", userData.user.id)
    .in("role_code", ["platform_admin", "platform_super_admin"])
    .is("revoked_at", null);

  if (roles.error || !roles.data?.length) {
    res.status(403).json({
      error: AdminErrorCode.FORBIDDEN,
      message: "Papel administrativo ativo não encontrado.",
      requestId: req.requestId,
    });
    return;
  }

  const active = roles.data.filter(
    (row) => !row.expires_at || new Date(row.expires_at).getTime() > Date.now(),
  );
  let role: AdminRole | null = null;
  const principalRole = principal.data.portal_role as AdminRole;
  if (
    portalRole === principalRole &&
    active.some((row) => row.role_code === principalRole)
  ) {
    role = principalRole;
  } else if (
    !portalRole &&
    active.some((row) => row.role_code === principalRole)
  ) {
    role = principalRole;
  }

  if (!role) {
    res.status(403).json({
      error: AdminErrorCode.FORBIDDEN,
      message: "Autorização administrativa expirada.",
      requestId: req.requestId,
    });
    return;
  }

  let sectors: AdminSectorCode[] = [];
  if (role === "platform_admin") {
    const members = await supabaseAdmin
      .from("app_admin_sector_members")
      .select("sector_code,expires_at,revoked_at")
      .eq("user_id", userData.user.id)
      .is("revoked_at", null);
    if (members.error) {
      res.status(503).json({ error: AdminErrorCode.UNAVAILABLE, requestId: req.requestId });
      return;
    }
    sectors = (members.data ?? [])
      .filter((row) => !row.expires_at || new Date(row.expires_at).getTime() > Date.now())
      .map((row) => row.sector_code as AdminSectorCode);
    if (!sectors.length) {
      res.status(403).json({
        error: AdminErrorCode.FORBIDDEN,
        message: "Administrador Setorial sem setor ativo.",
        requestId: req.requestId,
      });
      return;
    }
  }

  req.adminActor = {
    userId: userData.user.id,
    role,
    sectors,
    isSuperAdmin: role === "platform_super_admin",
    sessionIssuedAt: resolveSessionIssuedAt(token, userData.user.last_sign_in_at),
  };
  next();
}

export function requireSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.adminActor?.isSuperAdmin) {
    res.status(403).json({
      error: AdminErrorCode.FORBIDDEN,
      message: "Acesso restrito ao Super administrador.",
      requestId: req.requestId,
    });
    return;
  }
  next();
}

export function requireRecentAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.adminActor) {
    res.status(401).json({ error: AdminErrorCode.UNAUTHORIZED, requestId: req.requestId });
    return;
  }
  const issued = new Date(req.adminActor.sessionIssuedAt).getTime();
  if (!Number.isFinite(issued) || Date.now() - issued > 15 * 60_000) {
    res.status(401).json({
      error: AdminErrorCode.REAUTH_REQUIRED,
      message: "Reautenticação administrativa recente requerida.",
      requestId: req.requestId,
    });
    return;
  }
  next();
}
