import type { NextFunction, Request, Response } from "express";
import { createSupabasePublicClient, supabaseAdmin } from "../supabase/client.ts";
import { dbPool } from "../db/pool.ts";
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
  const authClient = supabaseAdmin ?? createSupabasePublicClient();
  if (!authClient) {
    res.status(503).json({ error: AdminErrorCode.UNAVAILABLE, requestId: req.requestId });
    return;
  }

  const { data: userData, error } = await authClient.auth.getUser(token);
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
  let principalData: { admin_user_id: string; portal_role: AdminRole } | null = null;
  let active: Array<{ role_code: AdminRole; expires_at: string | null }> = [];

  if (supabaseAdmin) {
    const [principal, roles, account] = await Promise.all([
      supabaseAdmin.from("app_admin_principals")
        .select("admin_user_id,portal_role").eq("admin_user_id", userData.user.id).maybeSingle(),
      supabaseAdmin.from("app_user_role_assignments")
        .select("role_code,expires_at,revoked_at").eq("user_id", userData.user.id)
        .in("role_code", ["platform_admin", "platform_super_admin"]).is("revoked_at", null),
      supabaseAdmin.from("app_users").select("status").eq("id", userData.user.id).maybeSingle(),
    ]);
    if (account.error) {
      res.status(503).json({ error: AdminErrorCode.UNAVAILABLE, requestId: req.requestId });
      return;
    }
    if (!account.data || account.data.status !== "active") {
      res.status(403).json({ error: AdminErrorCode.FORBIDDEN, requestId: req.requestId });
      return;
    }
    if (!principal.error && principal.data) {
      principalData = {
        admin_user_id: principal.data.admin_user_id,
        portal_role: principal.data.portal_role as AdminRole,
      };
    }

    if (!roles.error) {
      active = (roles.data ?? [])
        .filter(
          (row) =>
            !row.expires_at || new Date(row.expires_at).getTime() > Date.now(),
        )
        .map((row) => ({
          role_code: row.role_code as AdminRole,
          expires_at: row.expires_at,
        }));
    }
  }

  if ((!principalData || !active.length) && dbPool) {
    try {
      const principal = await dbPool.query<{
        admin_user_id: string;
        portal_role: AdminRole;
      }>(
        `SELECT admin_user_id,portal_role
           FROM public.app_admin_principals ap
           JOIN public.app_users u ON u.id=ap.admin_user_id AND u.status='active'
          WHERE admin_user_id=$1
          LIMIT 1`,
        [userData.user.id],
      );
      principalData = principal.rows[0] ?? principalData;

      const roles = await dbPool.query<{
        role_code: AdminRole;
        expires_at: Date | string | null;
      }>(
        `SELECT role_code,expires_at
           FROM public.app_user_role_assignments
          WHERE user_id=$1
            AND role_code IN ('platform_admin','platform_super_admin')
            AND revoked_at IS NULL
            AND (expires_at IS NULL OR expires_at>now())`,
        [userData.user.id],
      );
      active = roles.rows.map((row) => ({
        role_code: row.role_code,
        expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      }));
    } catch {
      // A decisão final abaixo permanece fail-closed.
    }
  }

  if (!principalData || principalData.admin_user_id !== userData.user.id) {
    res.status(401).json({
      error: AdminErrorCode.UNAUTHORIZED,
      message: "Sessão administrativa não está ativa.",
      requestId: req.requestId,
    });
    return;
  }

  if (!active.length) {
    res.status(403).json({
      error: AdminErrorCode.FORBIDDEN,
      message: "Papel administrativo ativo não encontrado.",
      requestId: req.requestId,
    });
    return;
  }
  let role: AdminRole | null = null;
  const principalRole = principalData.portal_role;
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
    if (supabaseAdmin) {
      const members = await supabaseAdmin
        .from("app_admin_sector_members")
        .select("sector_code,expires_at,revoked_at")
        .eq("user_id", userData.user.id)
        .is("revoked_at", null);
      if (!members.error) {
        sectors = (members.data ?? [])
          .filter(
            (row) =>
              !row.expires_at || new Date(row.expires_at).getTime() > Date.now(),
          )
          .map((row) => row.sector_code as AdminSectorCode);
      }
    }
    if (!sectors.length && dbPool) {
      try {
        const members = await dbPool.query<{ sector_code: AdminSectorCode }>(
          `SELECT sector_code
             FROM public.app_admin_sector_members
            WHERE user_id=$1
              AND revoked_at IS NULL
              AND (expires_at IS NULL OR expires_at>now())
            ORDER BY sector_code`,
          [userData.user.id],
        );
        sectors = members.rows.map((row) => row.sector_code);
      } catch {
        sectors = [];
      }
    }
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
