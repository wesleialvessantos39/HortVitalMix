import { Router } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import { dbPool } from "../db/pool.ts";
import {
  adminSessionMiddleware,
  requireAdminSector,
  requireRecentAuth,
} from "../middleware/adminSession.ts";
import { originProtection } from "../security/originProtection.ts";
import {supabaseAdmin,createSupabasePublicClient} from "../supabase/client.ts";
import {issueConfirmationContext} from "../security/confirmationContext.ts";
import {runtime} from "../config/runtime.ts";
import { reportFailure } from "../config/reportFailure.ts";

export const adminAccountReviewRouter = Router();
const accountGuard = [adminSessionMiddleware, requireAdminSector("account_governance")];
const command = z.object({ commandId: z.string().uuid() }).strict();
const decision = command.extend({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().min(3).max(1000),
});

adminAccountReviewRouter.get("/registration-reviews", ...accountGuard, async (_req, res) => {
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
  ...accountGuard,
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
        `SELECT u.status,p.cpf_normalized,p.full_name,coalesce(ap.admin_email,p.email_normalized) AS email_normalized,
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
      const protectedSuper = row.is_super && (req.adminActor.role !== "platform_super_admin" || !(await client.query(
        `SELECT 1 FROM public.app_users u JOIN public.app_admin_principals ap ON ap.admin_user_id=u.id
         JOIN public.app_user_role_assignments r ON r.user_id=u.id AND r.role_code='platform_super_admin'
         WHERE u.id<>$1 AND ap.portal_role='platform_super_admin' AND u.status='active'
         AND r.revoked_at IS NULL AND r.expires_at IS NULL AND hvm_governance_private.has_permission(u.id,'account_governance')`,[id.data])).rowCount);
      if (protectedSuper || id.data === req.adminActor.userId) {
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
        `INSERT INTO public.app_account_deletions(user_id,cpf_normalized,name_key,deleted_by,email_normalized)
   VALUES($1,$2,public.governance_name_key($3::text),$4,$5)`,
        [id.data, row.cpf_normalized, row.full_name, req.adminActor.userId,row.email_normalized],
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
      await client.query("SELECT public.delete_active_account($1,$2)",[id.data,req.adminActor.userId]);
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
  ...accountGuard,
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
        res.json({ status: "reviewed",confirmationSent:await sendApprovalConfirmation(id.data) });
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
        !["pending", "deleted", "blocked", "suspended"].includes(row.account_status)
      ) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "REVIEW_ALREADY_DECIDED" });
        return;
      }
      if (parsed.data.decision === "approved") {
        await client.query("UPDATE public.app_people p SET archived_at=now() FROM public.app_users u WHERE p.user_id=u.id AND u.id=ANY($2::uuid[]) AND u.id<>$1 AND u.status IN ('blocked','suspended','deleted') AND p.cpf_normalized=(SELECT cpf_normalized FROM public.app_people WHERE user_id=$1)",[row.user_id,row.matched_user_ids]);
        await client.query("UPDATE public.app_people SET registration_review_pending=false WHERE user_id=$1",[row.user_id]);
        await client.query("UPDATE auth.users SET email_confirmed_at=NULL,raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)||'{\"registration_approved\":true}'::jsonb WHERE id=$1",[row.user_id]);
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
      const confirmationSent=parsed.data.decision==="approved" ? await sendApprovalConfirmation(id.data) : false;
      res.json({ status: "reviewed", confirmationSent });
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

async function sendApprovalConfirmation(reviewId:string) {
 if(!dbPool || !supabaseAdmin)return false;
 const row=(await dbPool.query("SELECT r.user_id,p.email_normalized,coalesce(r.requested_role,(SELECT role_code FROM public.app_user_role_assignments WHERE user_id=r.user_id AND role_code IN ('producer','consumer') AND revoked_at IS NULL LIMIT 1)) AS role FROM public.app_registration_reviews r JOIN public.app_people p ON p.user_id=r.user_id JOIN public.app_users u ON u.id=r.user_id WHERE r.id=$1 AND r.status='approved' AND u.status='active' AND r.confirmation_sent_at IS NULL",[reviewId])).rows[0];
 if(!row || !['consumer','producer'].includes(row.role))return false;
 try {
  const client=createSupabasePublicClient();if(!client)return false;
  const context=issueConfirmationContext(row.user_id,row.role);
  const sent=await client.auth.resend({type:"signup",email:row.email_normalized,options:{emailRedirectTo:(runtime.origins[0]||"https://hortvitalmix.vercel.app")+"/confirmar-contato?portal="+row.role+"&context="+encodeURIComponent(context)}});
  if(sent.error)return false;
  await dbPool.query("UPDATE public.app_registration_reviews SET confirmation_sent_at=now() WHERE id=$1",[reviewId]);return true;
 }catch{return false;}
}
