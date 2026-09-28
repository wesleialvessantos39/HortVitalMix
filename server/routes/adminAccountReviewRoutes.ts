import { Router } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import { dbPool } from "../db/pool.ts";
import {
  adminSessionMiddleware,
  requireSuperAdmin,
  requireRecentAuth,
} from "../middleware/adminSession.ts";
import { originProtection } from "../security/originProtection.ts";
import { reportFailure } from "../config/reportFailure.ts";

export const adminAccountReviewRouter = Router();
adminAccountReviewRouter.use(adminSessionMiddleware, requireSuperAdmin);
const command = z.object({ commandId: z.string().uuid() }).strict();
const decision = command.extend({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().min(3).max(1000),
});

adminAccountReviewRouter.get("/registration-reviews", async (_req, res) => {
  try {
    if (!dbPool) throw new Error("UNAVAILABLE");
    const result =
      await dbPool.query(`SELECT r.id,r.user_id,r.reasons,r.created_at,r.requested_role,
    p.full_name,p.email_normalized, array_agg(DISTINCT roles.role_code) AS roles
    FROM public.app_registration_reviews r JOIN public.app_users u ON u.id=r.user_id
    JOIN public.app_people p ON p.user_id=u.id
    LEFT JOIN public.app_user_role_assignments roles ON roles.user_id=u.id AND roles.revoked_at IS NULL
    WHERE r.status='pending' GROUP BY r.id,p.full_name,p.email_normalized ORDER BY r.created_at LIMIT 200`);
    res.json({ reviews: result.rows });
  } catch {
    res.status(503).json({ error: "UNAVAILABLE" });
  }
});

adminAccountReviewRouter.post(
  "/users/:userId/delete",
  originProtection,
  requireRecentAuth,
  async (req, res) => {
    const parsed = command.safeParse(req.body),
      id = z.string().uuid().safeParse(req.params.userId);
    if (!parsed.success || !id.success) {
      res.status(422).json({ error: "VALIDATION_FAILED" });
      return;
    }
    let client: PoolClient | undefined;
    try {
      if (!dbPool || !req.adminActor) throw new Error("UNAVAILABLE");
      client = await dbPool.connect();
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('hvm-account-blocks'))",
      );
      const replay = await client.query(
        "SELECT 1 FROM public.app_audit_events WHERE actor_id=$1 AND command_id=$2 AND action='account.deleted' AND target_id=$3",
        [req.adminActor.userId, parsed.data.commandId, id.data],
      );
      if (replay.rowCount) {
        await client.query("COMMIT");
        res.json({ status: "deleted" });
        return;
      }
      const target = await client.query(
        `SELECT u.status,p.cpf_normalized,p.full_name,
   EXISTS(SELECT 1 FROM public.app_user_role_assignments r WHERE r.user_id=u.id AND r.role_code='platform_super_admin' AND r.revoked_at IS NULL) AS is_super
   FROM public.app_users u LEFT JOIN public.app_admin_principals ap ON ap.admin_user_id=u.id
   JOIN public.app_people p ON p.user_id=u.id OR p.id=ap.person_id WHERE u.id=$1 FOR UPDATE OF u`,
        [id.data],
      );
      const row = target.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "USER_NOT_FOUND" });
        return;
      }
      if (row.is_super || id.data === req.adminActor.userId) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "SUPER_ADMIN_PROTECTED" });
        return;
      }
      if (row.status === "deleted") {
        await client.query("COMMIT");
        res.json({ status: "deleted" });
        return;
      }
      await client.query(
        `INSERT INTO public.app_account_deletions(user_id,cpf_normalized,name_key,deleted_by)
   VALUES($1,$2,public.governance_name_key($3::text),$4)`,
        [id.data, row.cpf_normalized, row.full_name, req.adminActor.userId],
      );
      await client.query(
        `UPDATE public.app_users SET status='deleted',block_starts_at=NULL,block_ends_at=NULL,
   authorization_revision=authorization_revision+1,updated_at=now() WHERE id=$1`,
        [id.data],
      );
      await client.query(
        "UPDATE public.app_people SET archived_at=now() WHERE user_id=$1",
        [id.data],
      );
      await client.query(
        "UPDATE public.app_registration_reviews SET status='rejected',reviewed_at=now(),reviewed_by=$2,review_note='Conta excluída pela administração' WHERE user_id=$1 AND status='pending'",
        [id.data, req.adminActor.userId],
      );
      await client.query("DELETE FROM auth.sessions WHERE user_id=$1", [
        id.data,
      ]);
      await client.query(
        `INSERT INTO public.app_audit_events(request_id,actor_id,actor_role,action,target_entity,target_id,payload_before,payload_after,client_ip_hash,command_id)
    VALUES($1,$2,$3,'account.deleted','app_users',$4,$5,$6,$7,$8)`,
        [
          req.requestId,
          req.adminActor.userId,
          req.adminActor.role,
          id.data,
          JSON.stringify({ status: row.status }),
          JSON.stringify({ status: "deleted" }),
          req.clientIpHash,
          parsed.data.commandId,
        ],
      );
      await client.query("COMMIT");
      res.json({ status: "deleted" });
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => undefined);
      reportFailure({
        category: "account_delete_failed",
        requestId: req.requestId,
        detail: (error as { code?: string }).code ?? "unknown",
      });
      res.status(503).json({ error: "UNAVAILABLE" });
    } finally {
      client?.release();
    }
  },
);

adminAccountReviewRouter.post(
  "/registration-reviews/:reviewId/decision",
  originProtection,
  requireRecentAuth,
  async (req, res) => {
    const parsed = decision.safeParse(req.body),
      id = z.string().uuid().safeParse(req.params.reviewId);
    if (!parsed.success || !id.success) {
      res.status(422).json({ error: "VALIDATION_FAILED" });
      return;
    }
    let client: PoolClient | undefined;
    try {
      if (!dbPool || !req.adminActor) throw new Error("UNAVAILABLE");
      client = await dbPool.connect();
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('hvm-account-blocks'))",
      );
      const replay = await client.query(
        "SELECT 1 FROM public.app_audit_events WHERE actor_id=$1 AND command_id=$2 AND action='registration.reviewed' AND target_id=$3",
        [req.adminActor.userId, parsed.data.commandId, id.data],
      );
      if (replay.rowCount) {
        await client.query("COMMIT");
        res.json({ status: "reviewed" });
        return;
      }
      const result = await client.query(
        `SELECT r.*,u.status AS account_status FROM public.app_registration_reviews r JOIN public.app_users u ON u.id=r.user_id WHERE r.id=$1 FOR UPDATE OF r,u`,
        [id.data],
      );
      const row = result.rows[0];
      if (
        !row ||
        row.status !== "pending" ||
        !["pending", "deleted"].includes(row.account_status)
      ) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "REVIEW_ALREADY_DECIDED" });
        return;
      }
      if (parsed.data.decision === "approved") {
        // A identidade arquivada só volta se o CPF/e-mail não pertence a outro cadastro vigente.
        await client.query(
          "UPDATE public.app_people SET archived_at=NULL WHERE user_id=$1",
          [row.user_id],
        );
        await client.query(
          "UPDATE public.app_users SET status='active',authorization_revision=authorization_revision+1,block_starts_at=NULL,block_ends_at=NULL WHERE id=$1",
          [row.user_id],
        );
        if (row.requested_role) {
          if (row.account_status === "deleted") {
            const admin = await client.query(
              "SELECT 1 FROM public.app_admin_principals WHERE admin_user_id=$1",
              [row.user_id],
            );
            if (admin.rowCount)
              throw Object.assign(
                new Error("PRIVILEGED_REACTIVATION_FORBIDDEN"),
                { code: "23514" },
              );
          }
          await client.query(
            `INSERT INTO public.app_user_role_assignments(user_id,role_code) VALUES($1,$2) ON CONFLICT(user_id,role_code) DO UPDATE SET revoked_at=NULL,expires_at=NULL`,
            [row.user_id, row.requested_role],
          );
          if (row.requested_role === "producer")
            await client.query(
              `INSERT INTO public.app_producer_profiles(person_id,property_name,rural_activity_type)
     SELECT id,$2,$3 FROM public.app_people WHERE user_id=$1 ON CONFLICT(person_id) DO NOTHING`,
              [
                row.user_id,
                row.property_name || "Propriedade a cadastrar",
                row.activity_type || "misto",
              ],
            );
        }
      } else if (row.account_status === "pending")
        await client.query(
          "UPDATE public.app_users SET status='suspended',authorization_revision=authorization_revision+1 WHERE id=$1",
          [row.user_id],
        );
      await client.query(
        "UPDATE public.app_registration_reviews SET status=$2::text,review_note=$3,reviewed_at=now(),reviewed_by=$4 WHERE id=$1",
        [
          id.data,
          parsed.data.decision,
          parsed.data.note,
          req.adminActor.userId,
        ],
      );
      await client.query(
        `INSERT INTO public.app_audit_events(request_id,actor_id,actor_role,action,target_entity,target_id,payload_after,client_ip_hash,command_id)
   VALUES($1,$2,$3,'registration.reviewed','registration_reviews',$4,$5,$6,$7)`,
        [
          req.requestId,
          req.adminActor.userId,
          req.adminActor.role,
          id.data,
          JSON.stringify({ decision: parsed.data.decision }),
          req.clientIpHash,
          parsed.data.commandId,
        ],
      );
      await client.query("COMMIT");
      res.json({ status: "reviewed" });
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => undefined);
      const code = (error as { code?: string }).code;
      reportFailure({
        category: "registration_review_failed",
        requestId: req.requestId,
        detail: code ?? "unknown",
      });
      res
        .status(code === "23505" ? 409 : 503)
        .json({
          error: code === "23505" ? "IDENTITY_ALREADY_IN_USE" : "UNAVAILABLE",
        });
    } finally {
      client?.release();
    }
  },
);
