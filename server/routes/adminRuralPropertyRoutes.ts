import { Router } from "express";
import { z } from "zod";
import { dbPool } from "../db/pool.ts";
import {
  adminSessionMiddleware,
  requireRecentAuth,
} from "../middleware/adminSession.ts";
import { originProtection } from "../security/originProtection.ts";
import { redactPII } from "../security/redactPII.ts";
export const adminRuralPropertyRouter = Router();
adminRuralPropertyRouter.use(adminSessionMiddleware);
adminRuralPropertyRouter.use((req, res, next) => {
  if (
    !req.adminActor?.isSuperAdmin &&
    !req.adminActor?.sectors.includes("document_verification")
  ) {
    res.status(403).json({ error: "FORBIDDEN" });
    return;
  }
  next();
});
adminRuralPropertyRouter.get("/rural-properties", async (_req, res) => {
  if (!dbPool) {
    res.status(503).json({ error: "UNAVAILABLE" });
    return;
  }
  try {
    const result = await dbPool.query(`SELECT p.*,pe.full_name AS producer_name,
  COALESCE((SELECT jsonb_agg(b) FROM public.app_property_boundaries b WHERE b.property_id=p.id),'[]') AS boundaries,
  (SELECT to_jsonb(a) FROM public.app_rural_activities a WHERE a.property_id=p.id) AS activity
  FROM public.app_properties p JOIN public.app_producer_profiles pp ON pp.id=p.producer_id
  JOIN public.app_people pe ON pe.id=pp.person_id
  WHERE p.status<>'draft' ORDER BY (p.status='submitted') DESC,p.updated_at DESC LIMIT 200`);
    res.json({ properties: result.rows });
  } catch {
    res.status(503).json({ error: "UNAVAILABLE" });
  }
});
const Review = z
  .object({
    decision: z.enum(["verified", "rejected"]),
    expectedRevision: z.number().int().positive(),
    commandId: z.uuid(),
    reason: z.string().trim().max(500).default(""),
  })
  .strict()
  .refine((v) => v.decision !== "rejected" || v.reason.length >= 5, {
    message: "Informe o motivo para revisão",
  });
adminRuralPropertyRouter.post(
  "/rural-properties/:id/review",
  originProtection,
  requireRecentAuth,
  async (req, res) => {
    const input = Review.safeParse(req.body),
      id = z.uuid().safeParse(req.params.id);
    if (!input.success || !id.success) {
      res.status(422).json({ error: "VALIDATION_ERROR" });
      return;
    }
    if (!dbPool || !req.adminActor) {
      res.status(503).json({ error: "UNAVAILABLE" });
      return;
    }
    const client = await dbPool.connect().catch(() => null);
    if (!client) {
      res.status(503).json({ error: "UNAVAILABLE" });
      return;
    }
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        id.data,
      ]);
      const replay = await client.query(
        "SELECT target_id FROM public.app_audit_events WHERE command_id=$1 AND actor_id=$2 AND action='rural_property.reviewed'",
        [input.data.commandId, req.adminActor.userId],
      );
      if (replay.rows.length) {
        await client.query("COMMIT");
        res
          .status(replay.rows[0].target_id === id.data ? 200 : 409)
          .json({ status: "idempotent_replay" });
        return;
      }
      const updated = await client.query(
        "UPDATE public.app_properties SET status=$1 WHERE id=$2 AND revision=$3 AND status='submitted' RETURNING id,status,revision",
        [input.data.decision, id.data, input.data.expectedRevision],
      );
      if (!updated.rows.length) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "PROPERTY_REVISION_CONFLICT" });
        return;
      }
      await client.query(
        `INSERT INTO public.app_audit_events(request_id,actor_id,actor_role,action,target_entity,target_id,payload_after,client_ip_hash,command_id)
 VALUES($1,$2,$3,'rural_property.reviewed','app_properties',$4,$5,$6,$7)`,
        [
          req.requestId,
          req.adminActor.userId,
          req.adminActor.role,
          id.data,
          JSON.stringify(
            redactPII({
              decision: input.data.decision,
              reason: input.data.reason,
            }),
          ),
          req.clientIpHash,
          input.data.commandId,
        ],
      );
      await client.query("COMMIT");
      res.json({ property: updated.rows[0] });
    } catch {
      await client.query("ROLLBACK");
      res.status(503).json({ error: "UNAVAILABLE" });
    } finally {
      client.release();
    }
  },
);
