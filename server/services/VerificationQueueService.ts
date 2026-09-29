import type { PoolClient } from "pg";
import { dbPool } from "../db/pool.ts";
import { redactPII } from "../security/redactPII.ts";
import type { DecideVerificationRequest } from "../../shared/contracts/verificationQueue.ts";

const STALE_CLAIM_HOURS = 4;

export class VerificationQueueError extends Error {
  constructor(public code: string, public status: number, message?: string) {
    super(message ?? code);
  }
}

type AdminActor = { userId: string; role: string; isSuperAdmin: boolean; sectors: string[] };

function requirePool() {
  if (!dbPool) throw new VerificationQueueError("UNAVAILABLE", 503);
  return dbPool;
}

function assertAuditor(actor: AdminActor) {
  if (!actor.isSuperAdmin && !actor.sectors.includes("document_verification")) {
    throw new VerificationQueueError("FORBIDDEN", 403);
  }
}

export async function enqueueVerificationRequest(client: PoolClient, propertyId: string, producerId: string) {
  await client.query(
    `INSERT INTO public.app_verification_requests(property_id, producer_id, status, priority)
     SELECT $1, $2, 'pending', 0
     WHERE NOT EXISTS (
       SELECT 1 FROM public.app_verification_requests
       WHERE property_id = $1 AND status IN ('pending', 'claimed', 'in_review')
     )`,
    [propertyId, producerId],
  );
}

const LIST_SQL = `
SELECT r.id, r.property_id, r.producer_id, r.status, r.priority, r.claimed_by, r.claimed_at,
       r.created_at, r.updated_at, p.property_name, p.municipality, p.line_vicinal,
       p.total_area_hectares, p.cultivated_area_hectares, p.latitude_sede, p.longitude_sede,
       p.status AS property_status, p.revision, p.draft_data, p.registration_number,
       pe.full_name AS producer_name,
       (SELECT to_jsonb(b) FROM public.app_property_boundaries b
         WHERE b.property_id = p.id AND b.boundary_type = 'perimeter'
         ORDER BY b.created_at DESC LIMIT 1) AS perimeter,
       (SELECT jsonb_agg(jsonb_build_object('id', d.id, 'documentType', d.document_type, 'fileName', d.file_name, 'status', d.status, 'mimeType', d.mime_type))
         FROM public.app_documents d WHERE d.property_id = p.id AND d.status = 'clean') AS documents,
       (SELECT to_jsonb(e) FROM public.app_document_extractions e WHERE e.property_id = p.id ORDER BY e.created_at DESC LIMIT 1) AS extraction,
       (SELECT to_jsonb(dec) FROM public.app_verification_decisions dec WHERE dec.request_id = r.id ORDER BY dec.decided_at DESC LIMIT 1) AS last_decision
FROM public.app_verification_requests r
JOIN public.app_properties p ON p.id = r.property_id
JOIN public.app_producer_profiles pp ON pp.id = r.producer_id
JOIN public.app_people pe ON pe.id = pp.person_id
`;

export class VerificationQueueService {
  static async releaseStaleClaims(client: PoolClient) {
    await client.query(
      `UPDATE public.app_verification_requests
          SET status = 'pending', claimed_by = NULL, claimed_at = NULL, updated_at = clock_timestamp()
        WHERE status IN ('claimed', 'in_review') AND claimed_at IS NOT NULL
          AND claimed_at < clock_timestamp() - ($1 || ' hours')::interval
          AND NOT EXISTS (SELECT 1 FROM public.app_verification_decisions d WHERE d.request_id = app_verification_requests.id)`,
      [String(STALE_CLAIM_HOURS)],
    );
  }

  static async list(actor: AdminActor, tab: "pending" | "in_review" | "decided") {
    assertAuditor(actor);
    const client = await requirePool().connect();
    try {
      await this.releaseStaleClaims(client);
      const filter = tab === "pending" ? "r.status = 'pending'" : tab === "in_review" ? "r.status IN ('claimed', 'in_review')" : "r.status IN ('approved', 'rejected', 'escalated')";
      const result = await client.query(`${LIST_SQL} WHERE ${filter} ORDER BY r.priority DESC, r.created_at ASC LIMIT 200`);
      return { requests: result.rows };
    } finally {
      client.release();
    }
  }

  static async getOne(actor: AdminActor, requestId: string) {
    assertAuditor(actor);
    const result = await requirePool().query(`${LIST_SQL} WHERE r.id = $1`, [requestId]);
    if (!result.rows[0]) throw new VerificationQueueError("NOT_FOUND", 404);
    return { request: result.rows[0] };
  }

  static async claimRequest(actor: AdminActor, requestId: string, commandId: string, requestTraceId: string, ipHash: string) {
    assertAuditor(actor);
    const client = await requirePool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('verification:claim:' || $1))", [requestId]);
      await this.releaseStaleClaims(client);
      const replay = await client.query(`SELECT target_id FROM public.app_audit_events WHERE command_id = $1 AND actor_id = $2 AND action = 'verification.claimed'`, [commandId, actor.userId]);
      if (replay.rows.length) {
        await client.query("COMMIT");
        return { status: "idempotent_replay" as const, requestId: replay.rows[0].target_id };
      }
      const updated = await client.query(
        `UPDATE public.app_verification_requests SET status = 'claimed', claimed_by = $2, claimed_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1 AND status = 'pending' RETURNING *`,
        [requestId, actor.userId],
      );
      if (!updated.rows[0]) {
        await client.query("ROLLBACK");
        throw new VerificationQueueError("VERIFICATION_ALREADY_CLAIMED", 409);
      }
      await client.query(
        `INSERT INTO public.app_audit_events(request_id,actor_id,actor_role,action,target_entity,target_id,payload_after,client_ip_hash,command_id) VALUES($1,$2,$3,'verification.claimed','app_verification_requests',$4,$5,$6,$7)`,
        [requestTraceId, actor.userId, actor.role, requestId, JSON.stringify({ status: "claimed" }), ipHash, commandId],
      );
      await client.query("COMMIT");
      return { status: "claimed" as const, request: updated.rows[0] };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      if (error instanceof VerificationQueueError) throw error;
      throw new VerificationQueueError("UNAVAILABLE", 503);
    } finally {
      client.release();
    }
  }

  static async decideRequest(actor: AdminActor, requestId: string, input: DecideVerificationRequest, requestTraceId: string, ipHash: string) {
    assertAuditor(actor);
    const client = await requirePool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('verification:claim:' || $1))", [requestId]);
      const replay = await client.query(`SELECT target_id FROM public.app_audit_events WHERE command_id = $1 AND actor_id = $2 AND action = 'verification.decided'`, [input.commandId, actor.userId]);
      if (replay.rows.length) {
        await client.query("COMMIT");
        return { status: "idempotent_replay" as const };
      }
      const current = await client.query(`SELECT * FROM public.app_verification_requests WHERE id = $1 FOR UPDATE`, [requestId]);
      const row = current.rows[0];
      if (!row) throw new VerificationQueueError("NOT_FOUND", 404);
      if (!["claimed", "in_review"].includes(row.status)) throw new VerificationQueueError("VERIFICATION_NOT_CLAIMED", 409);
      if (row.claimed_by && row.claimed_by !== actor.userId && !actor.isSuperAdmin) throw new VerificationQueueError("VERIFICATION_CLAIMED_BY_OTHER", 409);
      const requestStatus = input.decision === "approved" ? "approved" : "rejected";
      const propertyStatus = input.decision === "approved" ? "verified" : input.decision === "rejected" ? "rejected" : "draft";
      await client.query(
        `INSERT INTO public.app_verification_decisions(request_id, auditor_id, decision, technical_opinion, assigned_trust_level, checklist_environmental_ok, checklist_land_tenure_ok, checklist_water_quality_ok) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [requestId, actor.userId, input.decision, input.technicalOpinion, input.assignedTrustLevel, input.checklistEnvironmentalOk, input.checklistLandTenureOk, input.checklistWaterQualityOk],
      );
      await client.query(`UPDATE public.app_verification_requests SET status = $2, updated_at = clock_timestamp() WHERE id = $1`, [requestId, requestStatus]);
      await client.query(`UPDATE public.app_properties SET status = $2, updated_at = clock_timestamp(), revision = revision + 1 WHERE id = $1`, [row.property_id, propertyStatus]);
      if (input.decision === "approved") {
        await client.query(`UPDATE public.app_producer_profiles SET verification_status = 'verified', trust_level = GREATEST(trust_level, $2), updated_at = clock_timestamp() WHERE id = $1`, [row.producer_id, input.assignedTrustLevel]);
      } else if (input.decision === "rejected") {
        await client.query(`UPDATE public.app_producer_profiles SET verification_status = 'rejected', updated_at = clock_timestamp() WHERE id = $1`, [row.producer_id]);
      }
      await client.query(
        `INSERT INTO public.app_audit_events(request_id,actor_id,actor_role,action,target_entity,target_id,payload_after,client_ip_hash,command_id) VALUES($1,$2,$3,'verification.decided','app_verification_requests',$4,$5,$6,$7)`,
        [requestTraceId, actor.userId, actor.role, requestId, JSON.stringify(redactPII({ decision: input.decision, assignedTrustLevel: input.assignedTrustLevel, technicalOpinion: input.technicalOpinion.slice(0, 400) })), ipHash, input.commandId],
      );
      await client.query("COMMIT");
      return { status: input.decision };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      if (error instanceof VerificationQueueError) throw error;
      if ((error as { code?: string }).code === "23514") throw new VerificationQueueError("CHECKLIST_INCOMPLETE", 422);
      throw new VerificationQueueError("UNAVAILABLE", 503);
    } finally {
      client.release();
    }
  }
}
