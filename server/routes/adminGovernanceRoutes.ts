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
    const code =
      result.status === "completed"
        ? 201
        : result.status === "identity_conflict"
          ? 409
          : result.status === "validation_failed"
            ? 422
            : result.status === "unavailable"
              ? 503
              : 403;
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
    if (result.status === "mfa_required") {
      res.status(200).json(result);
      return;
    }
    if (result.status === "rate_limited") {
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
  requireSuperAdmin,
  async (_req, res) => {
    res.status(200).json({ invites: await AdminGovernanceService.listInvites() });
  },
);

adminGovernanceRouter.post(
  "/invites",
  originProtection,
  adminSessionMiddleware,
  requireSuperAdmin,
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
      req.requestId,
      req.clientIpHash,
      origin,
    );
    res
      .status(
        result.status === "created"
          ? 201
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
  "/users",
  adminSessionMiddleware,
  requireSuperAdmin,
  async (_req, res) => {
    if (!dbPool) {
      res.status(503).json({ error: "UNAVAILABLE" });
      return;
    }
    const result = await dbPool.query(
      `SELECT u.id,u.status,p.full_name,p.email_normalized,
              r.role_code,
              COALESCE(array_agg(m.sector_code) FILTER (WHERE m.sector_code IS NOT NULL),'{}') AS sectors
         FROM public.app_users u
         JOIN public.app_people p ON p.user_id=u.id
         JOIN public.app_user_role_assignments r ON r.user_id=u.id
           AND r.revoked_at IS NULL
           AND (r.expires_at IS NULL OR r.expires_at>now())
         LEFT JOIN public.app_admin_sector_members m ON m.user_id=u.id
           AND m.revoked_at IS NULL
           AND (m.expires_at IS NULL OR m.expires_at>now())
        WHERE r.role_code IN ('platform_admin','platform_super_admin')
        GROUP BY u.id,p.full_name,p.email_normalized,r.role_code
        ORDER BY p.full_name`,
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
