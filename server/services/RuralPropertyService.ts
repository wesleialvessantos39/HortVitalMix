import type { PoolClient } from "pg";
import { dbPool } from "../db/pool.ts";
import { drainStorageDeletionQueue } from "./StorageDeletionQueueService.ts";
import { redactPII } from "../security/redactPII.ts";
import {
  propertyIsViewOnly,
  type SaveRuralDraftInput,
  type RuralPropertyView,
  type SaveWizardStepInput,
  type SubmitPropertyInput,
} from "../../shared/contracts/ruralProperty.ts";
import { propertyIdentityKey } from "../../shared/rural/propertyIdentity.ts";
import { declaredDocumentFields } from "../../shared/documents/effectiveDocumentFields.ts";
import type { ExtractionView } from "../../shared/contracts/aiExtraction.ts";
import {
  LOCALITY_DISABLED_MESSAGE,
  LOCALITY_NOT_COVERED_MESSAGE,
} from "../../shared/contracts/locality.ts";

export class RuralPropertyError extends Error {
  constructor(
    public code: string,
    public status: number,
    message = code,
  ) {
    super(message);
    this.name = "RuralPropertyError";
  }
}

function requirePool() {
  if (!dbPool) throw new RuralPropertyError("DATABASE_UNAVAILABLE", 503);
  return dbPool;
}

async function resolveProducer(
  client: PoolClient,
  userId: string,
  lock = false,
) {
  const result = await client.query<{ id: string }>(
    [
      "SELECT pp.id",
      "FROM public.app_producer_profiles pp",
      "JOIN public.app_people pe ON pe.id=pp.person_id",
      "WHERE pe.user_id=$1",
      lock ? "FOR UPDATE OF pp" : "",
    ].join(" "),
    [userId],
  );
  if (!result.rows[0])
    throw new RuralPropertyError("PRODUCER_PROFILE_REQUIRED", 403);
  return result.rows[0].id;
}

async function lockProperty(
  client: PoolClient,
  producerId: string,
  propertyId: string,
) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext($1::text))",
    [propertyId],
  );
  const result = await client.query<Record<string, any>>(
    "SELECT * FROM public.app_properties WHERE id=$1 AND producer_id=$2 FOR UPDATE",
    [propertyId, producerId],
  );
  if (!result.rows[0])
    throw new RuralPropertyError("PROPERTY_NOT_FOUND", 404);
  return result.rows[0];
}

async function matchingProperties(
  client: PoolClient,
  producerId: string,
  candidate: Record<string, any>,
  exceptId?: string,
) {
  const key = propertyIdentityKey({
    producerId,
    registrationNumber: candidate.registration_number ?? candidate.registrationNumber,
    propertyName: candidate.property_name ?? candidate.propertyName,
    municipality: candidate.municipality,
    lineVicinal: candidate.line_vicinal ?? candidate.lineVicinal,
  });
  if (!key) return [];
  const rows = await client.query<Record<string, any>>(
    `SELECT id, created_at, status, registration_number, property_name, municipality, line_vicinal, producer_id
       FROM public.app_properties WHERE producer_id=$1`,
    [producerId],
  );
  return rows.rows
    .filter(
      (row) =>
        row.id !== exceptId &&
        propertyIdentityKey({
          producerId,
          registrationNumber: row.registration_number,
          propertyName: row.property_name,
          municipality: row.municipality,
          lineVicinal: row.line_vicinal,
        }) === key,
    )
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
}

async function reopenPropertyVerification(
  client: PoolClient,
  propertyId: string,
  producerId: string,
) {
  const base = (
    await client.query("SELECT * FROM public.app_properties WHERE id=$1", [propertyId])
  ).rows[0] ?? {};
  const siblings = await matchingProperties(client, producerId, base, propertyId);

  for (const sibling of siblings) {
    await client.query(
      `UPDATE public.app_verification_requests
          SET property_id=$1, updated_at=clock_timestamp()
        WHERE property_id=$2`,
      [propertyId, sibling.id],
    );
  }

  const open = await client.query<{ id: string }>(
    `SELECT id
       FROM public.app_verification_requests
      WHERE property_id=$1
        AND superseded_at IS NULL
        AND status IN ('pending','claimed','in_review')
      ORDER BY created_at DESC,id DESC`,
    [propertyId],
  );
  const keepOpenId = open.rows[0]?.id ?? null;
  if (open.rows.length > 1) {
    await client.query(
      `DELETE FROM public.app_verification_requests r
        WHERE r.property_id=$1
          AND r.id = ANY($2::uuid[])
          AND NOT EXISTS (
            SELECT 1 FROM public.app_verification_decisions d
             WHERE d.request_id=r.id
          )`,
      [propertyId, open.rows.slice(1).map((row) => row.id)],
    );
  }

  if (keepOpenId) return;

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO public.app_verification_requests(property_id,producer_id,status,priority)
     VALUES($1,$2,'pending',0)
     RETURNING id`,
    [propertyId, producerId],
  );
  const newRequestId = inserted.rows[0].id;
  await client.query(
    `UPDATE public.app_verification_requests
        SET superseded_at=COALESCE(superseded_at,clock_timestamp()),
            superseded_by_request_id=$2,
            updated_at=clock_timestamp()
      WHERE property_id=$1
        AND id<>$2
        AND superseded_at IS NULL
        AND status IN ('approved','rejected','adjustments_required','escalated')`,
    [propertyId, newRequestId],
  );
}

async function replayTarget(
  client: PoolClient,
  commandId: string,
  userId: string,
  action: string,
) {
  const result = await client.query<{ target_id: string | null }>(
    "SELECT target_id FROM public.app_audit_events WHERE command_id=$1 AND actor_id=$2 AND action=$3 LIMIT 1",
    [commandId, userId, action],
  );
  return result.rows[0]?.target_id ?? null;
}

async function audit(
  client: PoolClient,
  args: {
    requestId: string;
    userId: string;
    role: string;
    action: string;
    targetId: string;
    before?: unknown;
    after?: unknown;
    ipHash: string;
    commandId: string;
  },
) {
  await client.query(
    [
      "INSERT INTO public.app_audit_events",
      "(request_id,actor_id,actor_role,action,target_entity,target_id,",
      "payload_before,payload_after,client_ip_hash,command_id)",
      "VALUES($1,$2,$3,$4,'app_properties',$5,$6,$7,$8,$9)",
    ].join(" "),
    [
      args.requestId,
      args.userId,
      args.role,
      args.action,
      args.targetId,
      args.before ? JSON.stringify(redactPII(args.before)) : null,
      args.after ? JSON.stringify(redactPII(args.after)) : null,
      args.ipHash,
      args.commandId,
    ],
  );
}

function summaryMetadata(row: Record<string, any>) {
  return {
    status: row.status,
    wizardCurrentStep: row.wizard_current_step,
    revision: row.revision,
    hasRegistrationNumber: Boolean(row.registration_number),
    hasAccessDirections: Boolean(row.access_directions),
    hasAreas:
      row.total_area_hectares !== null &&
      row.cultivated_area_hectares !== null,
    hasWaterSource: Boolean(row.water_source),
    hasIrrigationSystem: Boolean(row.irrigation_system),
  };
}

async function loadBoundaries(client: PoolClient, propertyId: string) {
  const result = await client.query<Record<string, any>>(
    "SELECT * FROM public.app_property_boundaries WHERE property_id=$1 ORDER BY created_at ASC,id ASC",
    [propertyId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    boundaryType: row.boundary_type,
    polygonGeojson: row.polygon_geojson,
    calculatedAreaHa:
      row.calculated_area_ha === null ? null : Number(row.calculated_area_ha),
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

async function loadActivity(client: PoolClient, propertyId: string) {
  const result = await client.query<Record<string, any>>(
    "SELECT * FROM public.app_rural_activities WHERE property_id=$1 LIMIT 1",
    [propertyId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    activityCategory: row.activity_category,
    productionSystem: row.production_system,
    hasWashingFacility: row.has_washing_facility,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function shownPropertyName(row: Record<string, any>) {
  const draftName =
    typeof row.draft_data?.propertyName === "string"
      ? row.draft_data.propertyName.trim()
      : "";
  if (draftName && !/^im[oó]vel sem nome/i.test(draftName)) return draftName;
  return String(row.property_name ?? draftName ?? "");
}
async function latestReview(client: PoolClient, propertyId: string) {
  const result = await client.query<{
    queue_status: string | null;
    review_decision: string | null;
  }>(
    `SELECT queue_status,review_decision
       FROM public.app_property_current_verification
      WHERE property_id=$1
      LIMIT 1`,
    [propertyId],
  );
  return result.rows[0] ?? { queue_status: null, review_decision: null };
}

async function mapProperty(
  client: PoolClient,
  row: Record<string, any>,
): Promise<RuralPropertyView> {
  const review = await latestReview(client, row.id);
  return {
    id: row.id,
    propertyName: shownPropertyName(row),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    draftData: row.draft_data,
    registrationNumber: row.registration_number,
    totalAreaHectares:
      row.total_area_hectares === null ? null : Number(row.total_area_hectares),
    cultivatedAreaHectares:
      row.cultivated_area_hectares === null
        ? null
        : Number(row.cultivated_area_hectares),
    ruralZoneSector: row.rural_zone_sector ?? "",
    lineVicinal: row.line_vicinal ?? "",
    municipality: row.municipality ?? "",
    state: row.state,
    latitudeSede: row.latitude_sede === null ? null : Number(row.latitude_sede),
    longitudeSede: row.longitude_sede === null ? null : Number(row.longitude_sede),
    accessDirections: row.access_directions,
    waterSource: row.water_source,
    irrigationSystem: row.irrigation_system,
    status: row.status,
    queueStatus: review.queue_status,
    reviewDecision: review.review_decision,
    wizardCurrentStep: row.wizard_current_step,
    revision: row.revision,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    boundaries: await loadBoundaries(client, row.id),
    activity: await loadActivity(client, row.id),
  };
}

async function assertEditable(client: PoolClient, row: Record<string, any>) {
  const review = await latestReview(client, row.id);
  if (propertyIsViewOnly({
    status: row.status,
    queueStatus: review.queue_status,
    reviewDecision: review.review_decision,
  }))
    throw new RuralPropertyError("PROPERTY_NOT_EDITABLE", 409, "Este imóvel aprovado só pode ser visualizado.");
}

function assertRevision(row: Record<string, any>, expected?: number) {
  if (typeof expected !== "number" || row.revision !== expected)
    throw new RuralPropertyError(
      "PROPERTY_REVISION_CONFLICT",
      409,
      "O imóvel foi alterado em outra sessão.",
    );
}

/**
 * Trava de cobertura e de publicação parcial por localidade.
 *
 * O imóvel é o que define a região de operação do produtor — pode morar em um
 * município e ter o imóvel em outro; o que vale é o município do imóvel.
 * Falha-fechado: município fora do catálogo, desativado, ou bloqueio parcial
 * de publicação impedem a criação/edição do imóvel naquela localidade.
 */
async function assertPropertyLocality(
  client: PoolClient,
  userId: string,
  state: string,
  municipality: string,
) {
  const resolved = await client.query<{
    id: string;
    name: string;
    state: string;
    coverage: string;
  }>(
    [
      "SELECT m.id,m.name,m.state,",
      "       CASE WHEN m.is_active THEN 'active' ELSE 'inactive' END AS coverage",
      "  FROM public.app_municipalities m",
      " WHERE m.state = upper($1)",
      "   AND m.name_normalized = public.fn_locality_normalize($2)",
      " LIMIT 1",
    ].join(" "),
    [state, municipality],
  );
  const row = resolved.rows[0];
  if (!row) throw new RuralPropertyError("LOCALITY_NOT_COVERED", 422, LOCALITY_NOT_COVERED_MESSAGE);
  if (row.coverage !== "active")
    throw new RuralPropertyError("LOCALITY_DISABLED", 403, LOCALITY_DISABLED_MESSAGE);

  const blocked = await client.query<{ blocked: boolean }>(
    "SELECT public.fn_is_publish_blocked($1::uuid,$2::uuid) AS blocked",
    [userId, row.id],
  );
  if (blocked.rows[0]?.blocked)
    throw new RuralPropertyError(
      "PUBLISHING_BLOCKED",
      403,
      "A publicação nesta localidade está suspensa pela administração da plataforma.",
    );
  return row;
}

async function assertComplete(client: PoolClient, row: Record<string, any>) {
  if (
    !row.property_name || !row.line_vicinal || !row.rural_zone_sector || !row.municipality || row.latitude_sede === null || row.longitude_sede === null ||
    row.total_area_hectares === null ||
    row.cultivated_area_hectares === null ||
    !row.water_source ||
    !row.irrigation_system
  )
    throw new RuralPropertyError("PROPERTY_INCOMPLETE", 422);

  const activity = await client.query<{
    activity_category: string;
    has_washing_facility: boolean;
  }>(
    "SELECT activity_category,has_washing_facility FROM public.app_rural_activities WHERE property_id=$1 LIMIT 1",
    [row.id],
  );
  if (!activity.rows[0])
    throw new RuralPropertyError("PROPERTY_ACTIVITY_REQUIRED", 422);
  if (
    activity.rows[0].activity_category === "legumes_picados" &&
    !activity.rows[0].has_washing_facility
  )
    throw new RuralPropertyError("WASHING_FACILITY_REQUIRED", 422);
}

type RequiredPropertyDocument = {
  extraction_id: string | null;
  extraction_status: string | null;
  property_name: string | null;
  municipality: string | null;
  total_area: string | null;
};

export function hasRequiredDocumentExtraction(
  documents: readonly RequiredPropertyDocument[],
) {
  return documents.some(
    (document) =>
      document.extraction_id &&
      ["completed", "flagged_discrepancy"].includes(
        document.extraction_status ?? "",
      ) &&
      Boolean(document.property_name?.trim()) &&
      Boolean(document.municipality?.trim()) &&
      Number(document.total_area) > 0,
  );
}

export function selectPropertyActivityCategory<T extends string>(
  explicit: T | undefined,
  inherited: T | undefined,
): T | undefined {
  return explicit ?? inherited;
}

async function assertRequiredPropertyDocument(client: PoolClient, propertyId: string) {
  const documents = await client.query<
    RequiredPropertyDocument & { id: string; dataReview: ExtractionView["dataReview"] }
  >(
    `SELECT d.id, e.id AS extraction_id, e.status AS extraction_status,
            e.payload_jsonb->>'propertyRegisteredName' AS property_name,
            e.payload_jsonb->>'municipality' AS municipality,
            e.payload_jsonb->>'totalAreaHectares' AS total_area,
            (SELECT to_jsonb(r) FROM public.app_document_reviews r WHERE r.extraction_id=e.id
              AND r.note LIKE 'Dados informados pelo produtor, sem leitura automática.%'
              ORDER BY r.created_at DESC,r.id DESC LIMIT 1) AS "dataReview"
       FROM public.app_documents d
       LEFT JOIN public.app_document_extractions e ON e.document_id=d.id
      WHERE d.property_id=$1 AND d.status='clean'
        AND d.document_type IN ('car_sicar','ccir_incra')`,
    [propertyId],
  );
  for (const doc of documents.rows) {
    const corrected = declaredDocumentFields({ dataReview: doc.dataReview } as ExtractionView);
    if (corrected) {
      if (typeof corrected.propertyRegisteredName === "string") doc.property_name = corrected.propertyRegisteredName;
      if (typeof corrected.municipality === "string") doc.municipality = corrected.municipality;
      if (typeof corrected.totalAreaHectares === "number") doc.total_area = String(corrected.totalAreaHectares);
    }
  }
  if (!documents.rows.length)
    throw new RuralPropertyError(
      "PROPERTY_DOCUMENTS_REQUIRED",
      422,
      "Envie o CAR ou o CCIR conferido antes da análise.",
    );
  if (!hasRequiredDocumentExtraction(documents.rows))
    throw new RuralPropertyError(
      "PROPERTY_DOCUMENT_DATA_REQUIRED",
      422,
      "Informe e salve os dados documentais antes da análise.",
    );
  return documents.rows;
}

async function transitionToSubmitted(
  client: PoolClient,
  producerId: string,
  current: Record<string, any>,
  completeOnly = false,
) {
  if (current.status === "rejected") {
    await client.query(
      "UPDATE public.app_properties SET status='draft' WHERE id=$1 AND producer_id=$2",
      [current.id, producerId],
    );
  }

  const updated = await client.query<Record<string, any>>(
    [
      "UPDATE public.app_properties",
      "SET wizard_current_step=6,status=$3,draft_data=NULL,completed_at=COALESCE(completed_at,now())",
      "WHERE id=$1 AND producer_id=$2 RETURNING *",
    ].join(" "),
    [current.id, producerId, completeOnly ? "completed" : "submitted"],
  );
  return updated.rows[0];
}

function mapDbError(error: unknown): never {
  if (error instanceof RuralPropertyError) throw error;
  const dbError = error as { code?: string; message?: string };
  if (
    dbError.code === "23514" &&
    dbError.message?.includes("VERIFIED_PROPERTY_REHOMOLOGATION_REQUIRED")
  )
    throw new RuralPropertyError("PROPERTY_REHOMOLOGATION_REQUIRED", 409);
  if (
    dbError.code === "23514" &&
    dbError.message?.includes("INVALID_PROPERTY_STATUS_TRANSITION")
  )
    throw new RuralPropertyError("PROPERTY_STATUS_CONFLICT", 409);
  throw error;
}

export class RuralPropertyService {
  static async saveDraft(userId:string,role:string,input:SaveRuralDraftInput,requestId:string,ipHash:string) {
    const client=await requirePool().connect();
    try {
      await client.query("BEGIN");const producerId=await resolveProducer(client,userId,true);
      const replay=await replayTarget(client,input.commandId,userId,"rural_property.draft_saved");
      let row:Record<string,any>;
      if(replay){row=(await client.query("SELECT * FROM public.app_properties WHERE id=$1 AND producer_id=$2",[replay,producerId])).rows[0];}
      else {
        if(input.propertyId){
          const current=await lockProperty(client,producerId,input.propertyId);await assertEditable(client,current);assertRevision(current,input.expectedRevision);
          row=(await client.query("UPDATE public.app_properties SET draft_data=$3::jsonb,status='draft',wizard_current_step=$4 WHERE id=$1 AND producer_id=$2 RETURNING *",[input.propertyId,producerId,JSON.stringify(input.draft),input.draft.step])).rows[0];
        }else{
          row=(await client.query("INSERT INTO public.app_properties(producer_id,draft_data,wizard_current_step) VALUES($1,$2::jsonb,$3) RETURNING *",[producerId,JSON.stringify(input.draft),input.draft.step])).rows[0];
        }
        await audit(client,{requestId,userId,role,action:"rural_property.draft_saved",targetId:row.id,after:summaryMetadata(row),ipHash,commandId:input.commandId});
      }
      if(!row)throw new RuralPropertyError("PROPERTY_NOT_FOUND",404);
      const property=await mapProperty(client,row);await client.query("COMMIT");return {property};
    }catch(e){await client.query("ROLLBACK");mapDbError(e);}finally{client.release();}
  }
  static async deleteDraft(userId:string,propertyId:string,expectedRevision:number,commandId:string,requestId:string,ipHash:string,acknowledgeLastApprovedRegion=false){
    const client=await requirePool().connect();
    try{
      await client.query("BEGIN");const producerId=await resolveProducer(client,userId,true);
      const replay=await replayTarget(client,commandId,userId,"rural_property.draft_deleted");
      if(!replay){
        const row=await lockProperty(client,producerId,propertyId);assertRevision(row,expectedRevision);
        if(row.status==='verified' && !acknowledgeLastApprovedRegion) {
          const others=await client.query("SELECT 1 FROM public.app_properties WHERE producer_id=$1 AND id<>$2 AND status='verified' AND state=$3 AND public.fn_locality_normalize(municipality)=public.fn_locality_normalize($4) LIMIT 1",[producerId,propertyId,row.state,row.municipality]);
          if(!others.rowCount)throw new RuralPropertyError("LAST_APPROVED_REGION_CONFIRMATION_REQUIRED",409,"Esse imóvel está aprovado. Ao apagá-lo você perde acesso à sua loja de vendas dessa região.");
        }
        await audit(client,{userId,role:"producer",requestId,ipHash,commandId,action:"rural_property.draft_deleted",targetId:propertyId,before:summaryMetadata(row)});
        await client.query("DELETE FROM public.app_properties WHERE id=$1 AND producer_id=$2",[propertyId,producerId]);
        await client.query("UPDATE public.app_producer_profiles SET verification_status='declared' WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM public.app_properties WHERE producer_id=$1 AND status='verified')",[producerId]);
      }
      await client.query("COMMIT");
    }catch(e){await client.query("ROLLBACK");mapDbError(e);}finally{client.release();}
    await drainStorageDeletionQueue();
  }
  static async deletionImpact(userId: string, propertyId: string) {
    const client = await requirePool().connect();
    try {
      const producerId = await resolveProducer(client,userId);
      const row = await lockProperty(client,producerId,propertyId);
      const others = await client.query("SELECT count(*)::int count FROM public.app_properties WHERE producer_id=$1 AND id<>$2 AND status='verified' AND state=$3 AND public.fn_locality_normalize(municipality)=public.fn_locality_normalize($4)",[producerId,propertyId,row.state,row.municipality]);
      return {revision:row.revision, approved:row.status==='verified',lastApprovedInRegion:row.status==='verified' && others.rows[0].count===0,municipality:row.municipality,state:row.state};
    } finally {client.release();}
  }
  static async listProperties(userId: string) {
    const client = await requirePool().connect();
    try {
      const producerId = await resolveProducer(client, userId);
      const result = await client.query<Record<string, any>>(
        `SELECT p.id,p.property_name,p.line_vicinal,p.municipality,p.state,p.status,
                p.wizard_current_step,p.revision,p.updated_at,p.completed_at,p.draft_data,
                p.registration_number,p.producer_id,
                cv.queue_status,
                cv.review_decision,
                cv.review_opinion,
                cv.previous_review_decision,
                cv.previous_review_opinion
           FROM public.app_properties p
           LEFT JOIN public.app_property_current_verification cv
             ON cv.property_id=p.id
          WHERE p.producer_id=$1 AND p.status<>'withdrawn'
          ORDER BY p.updated_at DESC,p.id ASC`,
        [producerId],
      );

      const groups = new Map<string, Record<string, any>[]>();
      for (const row of result.rows) {
        const key =
          propertyIdentityKey({
            producerId,
            registrationNumber: row.registration_number,
            propertyName: row.property_name,
            municipality: row.municipality,
            lineVicinal: row.line_vicinal,
          }) ?? row.id;
        const bucket = groups.get(key) ?? [];
        bucket.push(row);
        groups.set(key, bucket);
      }

      const visible = [...groups.values()].map((bucket) => {
        const verified = bucket.find((row) => row.status === "verified");
        const open = bucket.find((row) =>
          ["pending", "claimed", "in_review"].includes(row.queue_status),
        );
        return verified ?? open ?? bucket[0];
      });

      return visible.map((row) => ({
        id: row.id,
        propertyName: shownPropertyName(row),
        completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
        draftData: row.draft_data,
        lineVicinal: row.line_vicinal ?? "",
        municipality: row.municipality ?? "",
        state: row.state,
        status: row.status,
        queueStatus: row.queue_status ?? null,
        reviewDecision:
          row.review_decision ?? row.previous_review_decision ?? null,
        reviewOpinion:
          row.review_opinion ?? row.previous_review_opinion ?? null,
        wizardCurrentStep: row.wizard_current_step,
        revision: row.revision,
        updatedAt: new Date(row.updated_at).toISOString(),
      }));
    } finally {
      client.release();
    }
  }

  static async getDefaultActivity(userId: string) {
    const client = await requirePool().connect();
    try {
      const producerId = await resolveProducer(client, userId);
      const result = await client.query<{ activity_category: string }>(
        `SELECT a.activity_category
           FROM public.app_rural_activities a
           JOIN public.app_properties p ON p.id=a.property_id
          WHERE p.producer_id=$1
          ORDER BY p.created_at ASC,p.id ASC
          LIMIT 1`,
        [producerId],
      );
      return { activityCategory: result.rows[0]?.activity_category ?? null };
    } finally {
      client.release();
    }
  }

  static async getProperty(userId: string, propertyId: string) {
    const client = await requirePool().connect();
    try {
      const producerId = await resolveProducer(client, userId);
      const result = await client.query<Record<string, any>>(
        "SELECT * FROM public.app_properties WHERE id=$1 AND producer_id=$2",
        [propertyId, producerId],
      );
      if (!result.rows[0])
        throw new RuralPropertyError("PROPERTY_NOT_FOUND", 404);
      return await mapProperty(client, result.rows[0]);
    } finally {
      client.release();
    }
  }

  static async saveWizardStep(
    userId: string,
    role: string,
    input: SaveWizardStepInput,
    requestId: string,
    ipHash: string,
  ) {
    const client = await requirePool().connect();
    try {
      await client.query("BEGIN");
      const producerId = await resolveProducer(client, userId, true);
      const action = "rural_property.step_saved";
      const replayId = await replayTarget(
        client,
        input.commandId,
        userId,
        action,
      );

      if (replayId) {
        const replay = await client.query<Record<string, any>>(
          "SELECT * FROM public.app_properties WHERE id=$1 AND producer_id=$2",
          [replayId, producerId],
        );
        if (!replay.rows[0])
          throw new RuralPropertyError("PROPERTY_NOT_FOUND", 404);
        const property = await mapProperty(client, replay.rows[0]);
        await client.query("COMMIT");
        return {
          status: "idempotent_replay" as const,
          property,
          nextStep: Math.min(6, input.step + 1),
        };
      }

      let propertyId = input.propertyId;
      let before: Record<string, any> | null = null;
      let row: Record<string, any>;
      let reusingIdentity = false;
      let submittedDocuments: Array<{ id: string; extraction_id: string | null }> | null = null;
      let stepLocality: {
        id: string;
        name: string;
        state: string;
        coverage: string;
      } | null = null;
      if (input.step === 2) {
        // Resolve pela fonte canônica ativa e persiste o nome oficial do catálogo.
        stepLocality = await assertPropertyLocality(
          client,
          userId,
          input.stepData.state,
          input.stepData.municipality,
        );
      }
      if (input.step === 2 && !propertyId) {
        const data = input.stepData;
        const matches = await matchingProperties(client, producerId, {
          registration_number: data.registrationNumber,
          property_name: data.propertyName,
          municipality: stepLocality?.name ?? data.municipality,
          line_vicinal: data.lineVicinal,
        });
        if (matches[0]) {
          propertyId = matches[0].id;
          reusingIdentity = true;
        }
      }

      if (input.step === 2 && !propertyId) {
        const data = input.stepData;
        const inserted = await client.query<Record<string, any>>(
          [
            "INSERT INTO public.app_properties",
            "(producer_id,property_name,registration_number,rural_zone_sector,",
            "line_vicinal,municipality,state,latitude_sede,longitude_sede,",
            "access_directions,wizard_current_step)",
            "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,2)",
            "RETURNING *",
          ].join(" "),
          [
            producerId,
            data.propertyName,
            data.registrationNumber || null,
            data.ruralZoneSector,
            data.lineVicinal,
            stepLocality?.name ?? data.municipality,
            stepLocality?.state ?? data.state,
            data.latitudeSede,
            data.longitudeSede,
            data.accessDirections || null,
          ],
        );
        row = inserted.rows[0];
        propertyId = row.id;
      } else {
        if (!propertyId)
          throw new RuralPropertyError("PROPERTY_ID_REQUIRED", 400);

        const current = await lockProperty(client, producerId, propertyId);
        before = current;
        await assertEditable(client, current);
        if (!reusingIdentity) assertRevision(current, input.expectedRevision);
        if(input.step<6 && current.status!=="draft") {
          await client.query("UPDATE public.app_properties SET status='draft' WHERE id=$1 AND producer_id=$2",[propertyId,producerId]);
        }

        if (input.step === 2) {
          const data = input.stepData;
          row = (
            await client.query<Record<string, any>>(
              [
                "UPDATE public.app_properties SET",
                "draft_data=NULL,property_name=$1,registration_number=$2,rural_zone_sector=$3,",
                "line_vicinal=$4,municipality=$5,state=$6,latitude_sede=$7,",
                "longitude_sede=$8,access_directions=$9,",
                "wizard_current_step=GREATEST(wizard_current_step,2)",
                "WHERE id=$10 AND producer_id=$11 RETURNING *",
              ].join(" "),
              [
                data.propertyName,
                data.registrationNumber || null,
                data.ruralZoneSector,
                data.lineVicinal,
                stepLocality?.name ?? data.municipality,
                stepLocality?.state ?? data.state,
                data.latitudeSede,
                data.longitudeSede,
                data.accessDirections || null,
                propertyId,
                producerId,
              ],
            )
          ).rows[0];
        } else if (input.step === 3) {
          const data = input.stepData;
          await client.query(
            "DELETE FROM public.app_property_boundaries WHERE property_id=$1",
            [propertyId],
          );
          for (const boundary of data.boundaries) {
            await client.query(
              [
                "INSERT INTO public.app_property_boundaries",
                "(property_id,boundary_type,polygon_geojson,calculated_area_ha)",
                "VALUES($1,$2,$3::jsonb,$4)",
              ].join(" "),
              [
                propertyId,
                boundary.boundaryType,
                JSON.stringify(boundary.polygonGeojson),
                boundary.calculatedAreaHa ?? null,
              ],
            );
          }
          row = (
            await client.query<Record<string, any>>(
              [
                "UPDATE public.app_properties SET",
                "total_area_hectares=$1,cultivated_area_hectares=$2,",
                "wizard_current_step=GREATEST(wizard_current_step,3)",
                "WHERE id=$3 AND producer_id=$4 RETURNING *",
              ].join(" "),
              [
                data.totalAreaHectares,
                data.cultivatedAreaHectares,
                propertyId,
                producerId,
              ],
            )
          ).rows[0];
        } else if (input.step === 4) {
          const data = input.stepData;
          row = (
            await client.query<Record<string, any>>(
              [
                "UPDATE public.app_properties SET",
                "water_source=$1,irrigation_system=$2,",
                "wizard_current_step=GREATEST(wizard_current_step,4)",
                "WHERE id=$3 AND producer_id=$4 RETURNING *",
              ].join(" "),
              [
                data.waterSource,
                data.irrigationSystem,
                propertyId,
                producerId,
              ],
            )
          ).rows[0];
        } else if (input.step === 5) {
          const data = input.stepData;
          let activityCategory = data.activityCategory;
          let inheritedCategory: typeof data.activityCategory;
          if (!activityCategory) {
            const inherited = await client.query<{
              activity_category: NonNullable<typeof data.activityCategory>;
            }>(
              `SELECT a.activity_category
                 FROM public.app_rural_activities a
                 JOIN public.app_properties p ON p.id=a.property_id
                WHERE p.producer_id=$1
                  AND p.id<>$2
                ORDER BY p.created_at ASC,p.id ASC
                LIMIT 1`,
              [producerId, propertyId],
            );
            inheritedCategory = inherited.rows[0]?.activity_category;
          }
          activityCategory = selectPropertyActivityCategory(
            activityCategory,
            inheritedCategory,
          );
          if (!activityCategory)
            throw new RuralPropertyError("PROPERTY_ACTIVITY_REQUIRED", 422);
          await client.query(
            [
              "INSERT INTO public.app_rural_activities",
              "(property_id,activity_category,production_system,has_washing_facility)",
              "VALUES($1,$2,$3,$4)",
              "ON CONFLICT(property_id) DO UPDATE SET",
              "activity_category=EXCLUDED.activity_category,",
              "production_system=EXCLUDED.production_system,",
              "has_washing_facility=EXCLUDED.has_washing_facility,",
              "updated_at=clock_timestamp()",
            ].join(" "),
            [
              propertyId,
              activityCategory,
              data.productionSystem,
              data.hasWashingFacility,
            ],
          );
          row = (
            await client.query<Record<string, any>>(
              [
                "UPDATE public.app_properties SET",
                "wizard_current_step=GREATEST(wizard_current_step,5)",
                "WHERE id=$1 AND producer_id=$2 RETURNING *",
              ].join(" "),
              [propertyId, producerId],
            )
          ).rows[0];
        } else {
          if(current.draft_data)throw new RuralPropertyError("PROPERTY_INCOMPLETE",422);
          // A etapa final nunca pode transformar um rascunho em "concluído"
          // com localidade desativada ou sem a prova documental da etapa 1.
          await assertPropertyLocality(
            client,
            userId,
            current.state,
            current.municipality,
          );
          await assertComplete(client, current);
          submittedDocuments = await assertRequiredPropertyDocument(
            client,
            current.id,
          );
          row = await transitionToSubmitted(client, producerId, current, input.completeOnly);
          if (!input.completeOnly)
            await reopenPropertyVerification(client, propertyId!, producerId);
        }
      }

      await audit(client, {
        requestId,
        userId,
        role,
        action,
        targetId: propertyId!,
        before: before ? summaryMetadata(before) : undefined,
        after: {
          ...summaryMetadata(row),
          savedStep: input.step,
          commitmentAccepted:
            input.step === 6
              ? input.stepData.agroecologicalCommitment
              : undefined,
          documents: submittedDocuments?.map((document) => ({
            id: document.id,
            declared: Boolean(document.extraction_id),
          })),
        },
        ipHash,
        commandId: input.commandId,
      });

      const property = await mapProperty(client, row);
      await client.query("COMMIT");
      return {
        status: input.step === 6 ? (input.completeOnly ? "completed" as const : "submitted" as const) : ("step_saved" as const),
        property,
        nextStep: Math.min(6, input.step + 1),
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      mapDbError(error);
    } finally {
      client.release();
    }
  }

  static async submitProperty(
    userId: string,
    role: string,
    propertyId: string,
    input: SubmitPropertyInput,
    requestId: string,
    ipHash: string,
  ) {
    const client = await requirePool().connect();
    try {
      await client.query("BEGIN");
      const producerId = await resolveProducer(client, userId, true);
      const action = "rural_property.submitted";
      const replayId = await replayTarget(
        client,
        input.commandId,
        userId,
        action,
      );
      if (replayId) {
        const replay = await client.query<Record<string, any>>(
          "SELECT * FROM public.app_properties WHERE id=$1 AND producer_id=$2",
          [replayId, producerId],
        );
        if (!replay.rows[0])
          throw new RuralPropertyError("PROPERTY_NOT_FOUND", 404);
        const property = await mapProperty(client, replay.rows[0]);
        await client.query("COMMIT");
        return { status: "idempotent_replay" as const, property };
      }

      const current = await lockProperty(client, producerId, propertyId);
      if (current.status === "submitted") {
        const property = await mapProperty(client, current);
        await audit(client, {
          requestId,
          userId,
          role,
          action,
          targetId: propertyId,
          before: summaryMetadata(current),
          after: summaryMetadata(current),
          ipHash,
          commandId: input.commandId,
        });
        await client.query("COMMIT");
        return { status: "submitted" as const, property };
      }

      await assertEditable(client, current);
      assertRevision(current, input.expectedRevision);
      if(current.draft_data)throw new RuralPropertyError("PROPERTY_INCOMPLETE",422);
      // Cobertura e bloqueio parcial revalidados no momento do envio: a região
      // pode ter sido desativada entre o rascunho e a submissão.
      await assertPropertyLocality(
        client,
        userId,
        current.state,
        current.municipality,
      );
      await assertComplete(client, current);
      const documents = await assertRequiredPropertyDocument(client, propertyId);

      const row = await transitionToSubmitted(
        client,
        producerId,
        current,
      );
      await reopenPropertyVerification(client, propertyId, producerId);

      await audit(client, {
        requestId,
        userId,
        role,
        action,
        targetId: propertyId,
        before: summaryMetadata(current),
        after: {
          ...summaryMetadata(row),
          commitmentAccepted: input.agroecologicalCommitment,
          documents: documents.map((row) => ({
            id: row.id,
            declared: Boolean(row.extraction_id),
          })),
        },
        ipHash,
        commandId: input.commandId,
      });

      const property = await mapProperty(client, row);
      await client.query("COMMIT");
      return { status: "submitted" as const, property };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      mapDbError(error);
    } finally {
      client.release();
    }
  }

  static async approvedDeletionImpact(userId: string, propertyId: string) {
    const client = await requirePool().connect();
    try {
      const producerId = await resolveProducer(client,userId);
      const current = await client.query<Record<string,any>>(
        `SELECT p.*
           FROM public.app_properties p
          WHERE p.id=$1 AND p.producer_id=$2 AND p.status='verified'`,
        [propertyId,producerId],
      );
      const row=current.rows[0];
      if(!row)throw new RuralPropertyError("PROPERTY_NOT_FOUND",404);
      const siblings=await client.query<{count:string}>(
        `SELECT count(*)::text AS count
           FROM public.app_properties p
          WHERE p.producer_id=$1
            AND p.id<>$2
            AND p.status='verified'
            AND p.state=$3
            AND public.fn_locality_normalize(p.municipality)=public.fn_locality_normalize($4)
            AND EXISTS (
              SELECT 1 FROM public.app_verification_requests vr
               WHERE vr.property_id=p.id
                 AND vr.status='approved'
                 AND vr.superseded_at IS NULL
            )`,
        [producerId,propertyId,row.state,row.municipality],
      );
      const remainingInRegion=Number(siblings.rows[0]?.count??0);
      return {
        propertyId,
        municipality: row.municipality,
        state: row.state,
        remainingApprovedInRegion: remainingInRegion,
        losesRegionAccess: remainingInRegion===0,
      };
    } finally {
      client.release();
    }
  }

  static async withdrawApproved(userId: string, propertyId: string, expectedRevision: number, commandId: string, requestId: string, ipHash: string) {
    return this.deleteDraft(userId, propertyId, expectedRevision, commandId, requestId, ipHash,true);
  }
}
