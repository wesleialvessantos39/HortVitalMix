import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { originProtection } from "../security/originProtection.ts";
import {
  adminSessionMiddleware,
  requireRecentAuth,
  requireSuperAdmin,
} from "../middleware/adminSession.ts";
import { AdminGovernanceService } from "../services/AdminGovernanceService.ts";
import {
  AcceptInviteSchema,
  AdminEmailConfirmationRequestSchema,
  AdminEmailConfirmationVerifySchema,
  AdminLoginSchema,
  BootstrapRequestSchema,
  CreateInviteSchema,
  MfaVerifySchema,
} from "../../shared/contracts/adminGovernance.ts";
import { dbPool } from "../db/pool.ts";
import { runtime } from "../config/runtime.ts";
import { safeRequestOrigin } from "../security/origin.ts";

export const adminGovernanceRouter = Router();

function setAdminSession(
  res: Response,
  data: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    role: "platform_admin" | "platform_super_admin";
  },
) {
  const opts = {
    httpOnly: true,
    secure: runtime.secureCookies,
    sameSite: "lax" as const,
    path: "/",
  };
  res.cookie("hvm_access", data.accessToken, {
    ...opts,
    maxAge: Math.max(60, data.expiresIn) * 1000,
  });
  res.cookie("hvm_refresh", data.refreshToken, {
    ...opts,
    maxAge: 30 * 86400 * 1000,
  });
  res.cookie("hvm_portal_role", data.role, {
    ...opts,
    maxAge: 30 * 86400 * 1000,
  });
}

adminGovernanceRouter.get("/bootstrap/status", async (_req, res) => {
  res.status(200).json(await AdminGovernanceService.getBootstrapStatus());
});

adminGovernanceRouter.post(
  "/bootstrap",
  originProtection,
  async (req: Request, res: Response) => {
    const parsed = BootstrapRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        status: "validation_failed",
        message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
        requestId: req.requestId,
      });
      return;
    }
    const result = await AdminGovernanceService.executeBootstrap(
      parsed.data,
      req.requestId,
      req.clientIpHash,
    );
    if (result.status === "completed") {
      res.status(201).json(result);
      return;
    }

    const mapped =
      result.status === "email_not_authorized"
        ? { code: 403, error: "BOOTSTRAP_EMAIL_NOT_AUTHORIZED" }
        : result.status === "already_closed"
          ? { code: 409, error: "BOOTSTRAP_ALREADY_CLOSED" }
          : result.status === "identity_conflict"
            ? { code: 409, error: "BOOTSTRAP_IDENTITY_CONFLICT" }
            : result.status === "validation_failed"
              ? { code: 422, error: "BOOTSTRAP_VALIDATION_FAILED" }
              : result.status === "disabled"
                ? { code: 503, error: "BOOTSTRAP_DISABLED" }
                : { code: 503, error: "BOOTSTRAP_UNAVAILABLE" };

    res.status(mapped.code).json({
      ...result,
      error: mapped.error,
      requestId: req.requestId,
    });
  },
);

adminGovernanceRouter.post(
  "/auth/email-confirmation/request",
  originProtection,
  async (req: Request, res: Response) => {
    const parsed = AdminEmailConfirmationRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ status: "validation_failed" });
      return;
    }

    const result = await AdminGovernanceService.requestAdminEmailConfirmation(
      parsed.data.email,
      parsed.data.portalRole,
    );

    if (result.status === "unavailable") {
      res.status(503).json(result);
      return;
    }
    if (result.status === "cooldown" && result.retryAfterSeconds) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
    }

    // Resposta deliberadamente não enumera contas administrativas.
    res.status(202).json(result);
  },
);

adminGovernanceRouter.post(
  "/auth/email-confirmation/verify",
  originProtection,
  async (req: Request, res: Response) => {
    const parsed = AdminEmailConfirmationVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ status: "validation_failed" });
      return;
    }

    const result = await AdminGovernanceService.verifyAdminEmailConfirmation(
      parsed.data.email,
      parsed.data.otp,
      parsed.data.portalRole,
    );

    const code =
      result.status === "verified" || result.status === "already_verified"
        ? 200
        : result.status === "invalid_code"
          ? 422
          : 503;
    res.status(code).json(result);
  },
);

adminGovernanceRouter.post(
  "/auth/login",
  originProtection,
  async (req: Request, res: Response) => {
    const parsed = AdminLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ status: "validation_failed" });
      return;
    }
    const result = await AdminGovernanceService.login(
      parsed.data.email,
      parsed.data.password,
      req.clientIpHash,
      req.requestId,
      parsed.data.portalRole,
    );
    if (result.status === "session_created") {
      setAdminSession(res, result);
      res.status(200).json({
        status: result.status,
        role: result.role,
        sectors: result.sectors,
      });
      return;
    }
    if (
      result.status === "mfa_required" ||
      result.status === "email_confirmation_required"
    ) {
      res.status(200).json(result);
      return;
    }
    if (
      result.status === "rate_limited" ||
      result.status === "email_rate_limited"
    ) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      res.status(429).json(result);
      return;
    }
    res
      .status(result.status === "unavailable" ? 503 : 401)
      .json(result);
  },
);

adminGovernanceRouter.post(
  "/auth/mfa/verify",
  originProtection,
  async (req: Request, res: Response) => {
    const parsed = MfaVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ status: "validation_failed" });
      return;
    }
    const result = await AdminGovernanceService.verifyMfa(
      parsed.data.challengeId,
      parsed.data.otp,
      req.clientIpHash,
    );
    if (result.status === "verified") {
      setAdminSession(res, result);
      res.status(200).json({
        status: result.status,
        role: result.role,
        sectors: result.sectors,
      });
      return;
    }
    const code =
      result.status === "invalid_code"
        ? 422
        : result.status === "unavailable"
          ? 503
          : 410;
    res.status(code).json(result);
  },
);

adminGovernanceRouter.get(
  "/auth/verify-session",
  adminSessionMiddleware,
  async (req: Request, res: Response) => {
    if (!req.adminActor) return;
    const result = await AdminGovernanceService.verifyAdminSession(
      req.adminActor.userId,
      req.adminActor.role,
      req.adminActor.sessionIssuedAt,
    );
    res.status(200).json(result);
  },
);

adminGovernanceRouter.get(
  "/invites",
  adminSessionMiddleware,
  async (req: Request, res: Response) => {
    if (!req.adminActor) return;
    res.status(200).json({
      invites: await AdminGovernanceService.listInvites(
        req.adminActor.userId,
        req.adminActor.role,
      ),
    });
  },
);

adminGovernanceRouter.post(
  "/invites",
  originProtection,
  adminSessionMiddleware,
  requireRecentAuth,
  async (req: Request, res: Response) => {
    const parsed = CreateInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        status: "validation_failed",
        message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
        requestId: req.requestId,
      });
      return;
    }
    if (!req.adminActor) return;
    const origin =
      safeRequestOrigin(req) ??
      runtime.origins[0] ??
      "https://hortvitalmix.vercel.app";
    const result = await AdminGovernanceService.createInvite(
      parsed.data,
      req.adminActor.userId,
      req.adminActor.role,
      req.adminActor.sectors,
      req.requestId,
      req.clientIpHash,
      origin,
    );
    res
      .status(
        result.status === "created"
          ? 201
          : result.status === "forbidden"
            ? 403
            : result.status === "conflict"
              ? 409
              : 503,
      )
      .json(result);
  },
);

adminGovernanceRouter.get(
  "/invites/validate",
  async (req: Request, res: Response) => {
    const token = String(req.query.token ?? "");
    if (!token) {
      res.status(422).json({ status: "invalid" });
      return;
    }
    res.status(200).json(await AdminGovernanceService.validateInviteToken(token));
  },
);

adminGovernanceRouter.post(
  "/invites/accept",
  originProtection,
  async (req: Request, res: Response) => {
    const parsed = AcceptInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        status: "validation_failed",
        message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
        requestId: req.requestId,
      });
      return;
    }
    const result = await AdminGovernanceService.acceptInvite(
      parsed.data,
      req.requestId,
      req.clientIpHash,
    );
    const code =
      result.status === "accepted"
        ? 201
        : result.status === "identity_conflict"
          ? 409
          : result.status === "validation_failed"
            ? 422
            : result.status === "unavailable"
              ? 503
              : 410;
    res.status(code).json(result);
  },
);

adminGovernanceRouter.get(
  "/sectors",
  adminSessionMiddleware,
  async (req: Request, res: Response) => {
    if (!req.adminActor || !dbPool) {
      res.status(503).json({ error: "UNAVAILABLE" });
      return;
    }
    if (req.adminActor.isSuperAdmin) {
      const result = await dbPool.query(
        `SELECT code,name,description FROM public.app_admin_sectors
          WHERE is_active=true ORDER BY name`,
      );
      res.status(200).json({ sectors: result.rows });
      return;
    }
    const result = await dbPool.query(
      `SELECT s.code,s.name,s.description
         FROM public.app_admin_sectors s
         JOIN public.app_admin_sector_members m ON m.sector_code=s.code
        WHERE m.user_id=$1 AND m.revoked_at IS NULL
          AND (m.expires_at IS NULL OR m.expires_at>now())
          AND s.is_active=true ORDER BY s.name`,
      [req.adminActor.userId],
    );
    res.status(200).json({ sectors: result.rows });
  },
);

adminGovernanceRouter.get(
  "/identities/lookup",
  adminSessionMiddleware,
  async (req: Request, res: Response) => {
    if (!dbPool || !req.adminActor) {
      res.status(503).json({ error: "UNAVAILABLE" });
      return;
    }

    const rawCpf = String(req.query.cpf ?? "").replace(/\D/g, "");
    const rawEmail = String(req.query.email ?? "").trim().toLowerCase();
    if (!/^\d{11}$/.test(rawCpf) && !z.string().email().safeParse(rawEmail).success) {
      res.status(422).json({ error: "VALIDATION_FAILED" });
      return;
    }

    const result = await dbPool.query<{
      id: string;
      user_id: string;
      full_name: string;
      cpf_normalized: string;
      email_normalized: string;
      status: string;
      public_roles: string[];
      admin_roles: Array<"platform_admin" | "platform_super_admin">;
    }>(
      `SELECT p.id,p.user_id,p.full_name,p.cpf_normalized,p.email_normalized,u.status,
              COALESCE(array_agg(DISTINCT r.role_code) FILTER (
                WHERE r.role_code IN ('consumer','producer')
                  AND r.revoked_at IS NULL
                  AND (r.expires_at IS NULL OR r.expires_at>now())
              ),'{}') AS public_roles,
              ARRAY(
                SELECT ap.portal_role
                  FROM public.app_admin_principals ap
                 WHERE ap.person_id=p.id
                 ORDER BY ap.portal_role
              ) AS admin_roles
         FROM public.app_people p
         JOIN public.app_users u ON u.id=p.user_id
         LEFT JOIN public.app_user_role_assignments r ON r.user_id=p.user_id
        WHERE ($1::text <> '' AND p.cpf_normalized=$1)
           OR ($2::text <> '' AND p.email_normalized=$2)
        GROUP BY p.id,p.user_id,p.full_name,p.cpf_normalized,p.email_normalized,u.status
        LIMIT 1`,
      [rawCpf, rawEmail],
    );

    const identity = result.rows[0];
    if (!identity) {
      res.status(200).json({ found: false });
      return;
    }

    res.status(200).json({
      found: true,
      identity: {
        fullName: identity.full_name,
        cpf: identity.cpf_normalized,
        publicEmail: identity.email_normalized,
        status: identity.status,
        publicRoles: identity.public_roles,
        adminRoles: identity.admin_roles,
      },
    });
  },
);

adminGovernanceRouter.get(
  "/users",
  adminSessionMiddleware,
  async (req: Request, res: Response) => {
    if (!dbPool || !req.adminActor) {
      res.status(503).json({ error: "UNAVAILABLE" });
      return;
    }

    const params: unknown[] = [];
    let scope = "";
    if (!req.adminActor.isSuperAdmin) {
      params.push(req.adminActor.userId);
      scope = `
        AND ar.role_code='platform_admin'
        AND EXISTS (
          SELECT 1
            FROM public.app_admin_sector_members target_sector
            JOIN public.app_admin_sector_members actor_sector
              ON actor_sector.sector_code=target_sector.sector_code
             AND actor_sector.user_id=$1
             AND actor_sector.revoked_at IS NULL
             AND (actor_sector.expires_at IS NULL OR actor_sector.expires_at>now())
           WHERE target_sector.user_id=u.id
             AND target_sector.revoked_at IS NULL
             AND (target_sector.expires_at IS NULL OR target_sector.expires_at>now())
        )`;
    }

    const result = await dbPool.query(
      `SELECT u.id,u.status,p.full_name,ap.admin_email AS email_normalized,
              ar.role_code,
              COALESCE(array_agg(DISTINCT m.sector_code) FILTER (
                WHERE m.sector_code IS NOT NULL
              ),'{}') AS sectors,
              COALESCE(array_agg(DISTINCT pr.role_code) FILTER (
                WHERE pr.role_code IN ('consumer','producer')
                  AND pr.revoked_at IS NULL
                  AND (pr.expires_at IS NULL OR pr.expires_at>now())
              ),'{}') AS public_roles
         FROM public.app_users u
         JOIN public.app_admin_principals ap ON ap.admin_user_id=u.id
         JOIN public.app_people p ON p.id=ap.person_id
         JOIN public.app_user_role_assignments ar ON ar.user_id=u.id
           AND ar.revoked_at IS NULL
           AND (ar.expires_at IS NULL OR ar.expires_at>now())
           AND ar.role_code IN ('platform_admin','platform_super_admin')
         LEFT JOIN public.app_user_role_assignments pr ON pr.user_id=p.user_id
           AND pr.role_code IN ('consumer','producer')
         LEFT JOIN public.app_admin_sector_members m ON m.user_id=u.id
           AND m.revoked_at IS NULL
           AND (m.expires_at IS NULL OR m.expires_at>now())
        WHERE 1=1 ${scope}
        GROUP BY u.id,p.full_name,ap.admin_email,ar.role_code
        ORDER BY p.full_name`,
      params,
    );
    res.status(200).json({ users: result.rows });
  },
);

const StatusChangeSchema = z.object({
  status: z.enum(["active", "blocked"]),
  commandId: z.string().uuid(),
}).strict();

adminGovernanceRouter.patch(
  "/users/:userId/status",
  originProtection,
  adminSessionMiddleware,
  requireSuperAdmin,
  requireRecentAuth,
  async (req: Request, res: Response) => {
    if (!dbPool || !req.adminActor) {
      res.status(503).json({ error: "UNAVAILABLE" });
      return;
    }
    const parsed = StatusChangeSchema.safeParse(req.body);
    const userId = z.string().uuid().safeParse(req.params.userId);
    if (!parsed.success || !userId.success) {
      res.status(422).json({ error: "VALIDATION_FAILED" });
      return;
    }
    if (parsed.data.status === "blocked") {
      const last = await dbPool.query<{ protected: boolean }>(
        `SELECT public.fn_is_last_active_super_admin($1) AS protected`,
        [userId.data],
      );
      if (last.rows[0]?.protected) {
        res.status(409).json({ error: "LAST_SUPER_ADMIN_PROTECTED" });
        return;
      }
    }
    await dbPool.query(
      `UPDATE public.app_users
       SET status=$2,
           blocked_at=CASE WHEN $2='blocked' THEN clock_timestamp() ELSE NULL END,
           blocked_by=CASE WHEN $2='blocked' THEN $3 ELSE NULL END,
           block_reason=CASE WHEN $2='blocked' THEN 'administrative_governance' ELSE NULL END,
           authorization_revision=authorization_revision+1,
           revision=revision+1,
           updated_at=clock_timestamp()
       WHERE id=$1`,
      [userId.data, parsed.data.status, req.adminActor.userId],
    );
    res.status(200).json({ status: "updated" });
  },
);
