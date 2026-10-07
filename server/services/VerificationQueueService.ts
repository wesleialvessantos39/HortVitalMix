import { hasAdminPermission } from "../../shared/adminPermissions.ts";
import type { PoolClient } from "pg";
import { dbPool } from "../db/pool.ts";
import { redactPII } from "../security/redactPII.ts";
import type { DecideVerificationRequest } from "../../shared/contracts/verificationQueue.ts";
import { propertyIdentityKey } from "../../shared/rural/propertyIdentity.ts";

const STALE_CLAIM_HOURS = 4;

export class VerificationQueueError extends Error {
  constructor(public code: string, public status: number, message?: string) {
    super(message ?? code);
  }
}

type AdminActor = { userId: string; role: string; isSuperAdmin: boolean; sectors: string[] };
type QueueTab = "pending" | "in_review" | "decided" | "archived";

function requirePool() {
  if (!dbPool) throw new VerificationQueueError("UNAVAILABLE", 503);
  return dbPool;
}

function assertAuditor(actor: AdminActor) {
  if (!hasAdminPermission(actor, "document_verification")) {
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
       r.created_at, r.updated_at, r.archived_at, r.superseded_at, r.superseded_by_request_id, p.property_name, p.municipality, p.line_vicinal,
       p.total_area_hectares, p.cultivated_area_hectares, p.latitude_sede, p.longitude_sede,
       p.status AS property_status, p.revision, p.draft_data, p.registration_number,
       coalesce((SELECT profile.full_name FROM public.app_account_profiles profile WHERE profile.user_id=pe.user_id AND profile.role_code='producer'),pe.full_name) AS producer_name,
       (SELECT to_jsonb(b) FROM public.app_property_boundaries b
         WHERE b.property_id = p.id AND b.boundary_type = 'perimeter'
         ORDER BY b.created_at DESC LIMIT 1) AS perimeter,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', d.id, 'documentType', d.document_type, 'fileName', d.file_name, 'status', d.status, 'mimeType', d.mime_type) ORDER BY d.created_at), '[]'::jsonb)
         FROM (
           SELECT id, document_type, file_name, status, mime_type, created_at
           FROM public.app_documents
           WHERE property_id = p.id AND status <> 'archived'
           ORDER BY created_at
           LIMIT 10
         ) d) AS documents,
       (SELECT to_jsonb(e) - 'extraction_engine' - 'raw_text' FROM public.app_document_extractions e WHERE e.property_id = p.id ORDER BY e.created_at DESC LIMIT 1) AS extraction,
       (SELECT to_jsonb(dec) FROM public.app_verification_decisions dec WHERE dec.request_id = r.id ORDER BY dec.decided_at DESC LIMIT 1) AS last_decision,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('decision', dec.decision, 'technicalOpinion', dec.technical_opinion, 'decidedAt', dec.decided_at) ORDER BY dec.decided_at), '[]'::jsonb)
         FROM public.app_verification_decisions dec WHERE dec.request_id = r.id) AS decision_history
FROM public.app_verification_requests r
JOIN public.app_properties p ON p.id = r.property_id
JOIN public.app_producer_profiles pp ON pp.id = r.producer_id
JOIN public.app_people pe ON pe.id = pp.person_id
`;

function asList(value: unknown) {
  if (Array.isArray(value)) return value as Array<Record<string, any>>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as Array<Record<string, any>>) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function collapseQueue(rows: Array<Record<string, any>>, tab: QueueTab) {
  const groups = new Map<string, Array<Record<string, any>>>();
  for (const row of rows) {
    const key =
      propertyIdentityKey({
        producerId: String(row.producer_id),
        registrationNumber: row.registration_number,
        propertyName: row.property_name,
        municipality: row.municipality,
        lineVicinal: row.line_vicinal,
      }) ?? String(row.property_id);
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const visible: Array<Record<string, any>> = [];
  for (const bucket of groups.values()) {
    const current = bucket.filter(
      (row) =>
        !row.superseded_at &&
        row.property_status !== "withdrawn" &&
        row.property_status !== "suspended",
    );
    const open = current.filter((row) =>
      ["pending", "claimed", "in_review"].includes(row.status),
    );
    const approved = current.filter(
      (row) =>
        row.status === "approved" &&
        row.archived_at &&
        row.property_status === "verified",
    );

    let wanted: Array<Record<string, any>> = [];
    if (tab === "pending")
      wanted = current.filter((row) => row.status === "pending");
    else if (tab === "in_review")
      wanted = current.filter((row) =>
        ["claimed", "in_review"].includes(row.status),
      );
    else if (tab === "archived")
      wanted = approved;
    else if (!open.length && !approved.length)
      wanted = current.filter((row) =>
        ["rejected", "adjustments_required", "escalated"].includes(row.status),
      );

    if (!wanted.length) continue;
    const primary = [...wanted].sort(
      (a, b) =>
        new Date(b.updated_at ?? b.created_at).getTime() -
        new Date(a.updated_at ?? a.created_at).getTime(),
    )[0];

    const documents: Array<Record<string, any>> = [];
    const seen = new Set<string>();
    for (const row of bucket) {
      for (const doc of asList(row.documents)) {
        if (!doc?.id || seen.has(String(doc.id)) || documents.length >= 10)
          continue;
        seen.add(String(doc.id));
        documents.push(doc);
      }
    }

    const history = bucket
      .flatMap((row) => asList(row.decision_history))
      .sort((a, b) =>
        String(a.decidedAt).localeCompare(String(b.decidedAt)),
      );

    visible.push({ ...primary, documents, decision_history: history });
  }
  return visible;
}

async function matchingIdentityPropertyIds(
  client: PoolClient,
  producerId: string,
  propertyId: string,
) {
  const target = await client.query<Record<string, any>>(
    `SELECT id,registration_number,property_name,municipality,line_vicinal
       FROM public.app_properties
      WHERE id=$1 AND producer_id=$2
      LIMIT 1`,
    [propertyId, producerId],
  );
  const base = target.rows[0];
  if (!base) return [propertyId];

  const key = propertyIdentityKey({
    producerId,
    registrationNumber: base.registration_number,
    propertyName: base.property_name,
    municipality: base.municipality,
    lineVicinal: base.line_vicinal,
  });
  if (!key) return [propertyId];

  const all = await client.query<Record<string, any>>(
    `SELECT id,registration_number,property_name,municipality,line_vicinal
       FROM public.app_properties
      WHERE producer_id=$1`,
    [producerId],
  );
  const ids = all.rows
    .filter(
      (row) =>
        propertyIdentityKey({
          producerId,
          registrationNumber: row.registration_number,
          propertyName: row.property_name,
          municipality: row.municipality,
          lineVicinal: row.line_vicinal,
        }) === key,
    )
    .map((row) => String(row.id));
  return ids.length ? ids : [propertyId];
}

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

  static async list(actor: AdminActor, tab: QueueTab) {
    assertAuditor(actor);
    const client = await requirePool().connect();
    try {
      await this.releaseStaleClaims(client);
      const filter =
        tab === "pending"
          ? "r.status = 'pending' AND r.superseded_at IS NULL AND p.status NOT IN ('withdrawn','suspended')"
          : tab === "in_review"
            ? "r.status IN ('claimed', 'in_review') AND r.superseded_at IS NULL AND p.status NOT IN ('withdrawn','suspended')"
            : tab === "archived"
              ? "r.status = 'approved' AND r.archived_at IS NOT NULL AND r.superseded_at IS NULL AND p.status = 'verified'"
              : "r.status IN ('rejected', 'adjustments_required', 'escalated') AND r.superseded_at IS NULL AND p.status NOT IN ('verified','withdrawn','suspended')";
      const producers = await client.query(
        `SELECT DISTINCT r.producer_id
           FROM public.app_verification_requests r
           JOIN public.app_properties p ON p.id=r.property_id
          WHERE ${filter}`,
      );
      const ids = producers.rows.map((row) => row.producer_id);
      const result = ids.length
        ? await client.query(
            `${LIST_SQL} WHERE r.producer_id = ANY($1::uuid[]) ORDER BY r.created_at ASC`,
            [ids],
          )
        : { rows: [] };
      return { requests: collapseQueue(result.rows, tab) };
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
        `UPDATE public.app_verification_requests SET status = 'in_review', claimed_by = $2, claimed_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1 AND status = 'pending' RETURNING *`,
        [requestId, actor.userId],
      );
      if (!updated.rows[0]) {
        const existing = await client.query(
          `SELECT * FROM public.app_verification_requests WHERE id = $1`,
          [requestId],
        );
        const current = existing.rows[0];
        if (
          current &&
          ["claimed", "in_review"].includes(current.status) &&
          (current.claimed_by === actor.userId || actor.isSuperAdmin)
        ) {
          await client.query("COMMIT");
          return { status: "claimed" as const, request: current };
        }
        await client.query("ROLLBACK");
        throw new VerificationQueueError("VERIFICATION_ALREADY_CLAIMED", 409);
      }
      await client.query(
        `INSERT INTO public.app_audit_events(request_id,actor_id,actor_role,action,target_entity,target_id,payload_after,client_ip_hash,command_id) VALUES($1,$2,$3,'verification.claimed','app_verification_requests',$4,$5,$6,$7)`,
        [requestTraceId, actor.userId, actor.role, requestId, JSON.stringify({ status: "in_review" }), ipHash, commandId],
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
      const requestStatus = input.decision;
      const propertyStatus = input.decision === "approved" ? "verified" : "rejected";
      await client.query(
        `INSERT INTO public.app_verification_decisions(request_id, auditor_id, decision, technical_opinion, assigned_trust_level, checklist_environmental_ok, checklist_land_tenure_ok, checklist_water_quality_ok) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [requestId, actor.userId, input.decision, input.technicalOpinion, input.assignedTrustLevel, input.checklistEnvironmentalOk, input.checklistLandTenureOk, input.checklistWaterQualityOk],
      );
      await client.query(`UPDATE public.app_verification_requests SET status = $2, updated_at = clock_timestamp() WHERE id = $1`, [requestId, requestStatus]);
      if (input.decision === "approved") {
        const identityIds = await matchingIdentityPropertyIds(
          client,
          String(row.producer_id),
          String(row.property_id),
        );
        await client.query(
          `UPDATE public.app_verification_requests
              SET superseded_at=COALESCE(superseded_at,clock_timestamp()),
                  superseded_by_request_id=$1,
                  updated_at=clock_timestamp()
            WHERE property_id = ANY($2::uuid[])
              AND id<>$1
              AND superseded_at IS NULL
              AND status IN ('approved','rejected','adjustments_required','escalated')`,
          [requestId, identityIds],
        );
      }
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
