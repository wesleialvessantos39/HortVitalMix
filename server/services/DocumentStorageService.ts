import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { dbPool } from "../db/pool.ts";
import { supabaseAdmin } from "../supabase/client.ts";
import { inspectDocument } from "../security/magicBytes.ts";
import type { RequestUploadUrl, ManualDocumentData } from "../../shared/contracts/documents.ts";
import {
  ExtractionSchema,
  type ExtractionPayload,
} from "../../shared/contracts/aiExtraction.ts";
import { validateExtraction } from "./CarValidationEngine.ts";
export class DocumentError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
  }
}
export type DocumentActor = {
  userId: string;
  role: string;
  auditor: boolean;
  requestId: string;
  ipHash: string;
};
export function pool() {
  if (!dbPool) throw new DocumentError("UNAVAILABLE", 503);
  return dbPool;
}
export function storage() {
  if (!supabaseAdmin) throw new DocumentError("STORAGE_UNAVAILABLE", 503);
  return supabaseAdmin.storage.from("documents_private");
}
export async function transaction<T>(run: (c: PoolClient) => Promise<T>) {
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    const r = await run(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function applyExtractedProperty(
  c: Pick<PoolClient, "query">,
  propertyId: string,
  input: {
    propertyRegisteredName: string | null;
    municipality: string | null;
    registrationNumber?: string | null;
    totalAreaHectares: number | null;
    latitudeSede?: number | null;
    longitudeSede?: number | null;
    lineVicinal?: string | null;
    ruralZoneSector?: string | null;
    accessDirections?: string | null;
    cultivatedAreaHectares?: number | null;
    waterSource?: string | null;
    irrigationSystem?: string | null;
    activityCategory?: string | null;
    productionSystem?: string | null;
    hasWashingFacility?: boolean | null;
  },
) {
  const property = await c.query(
    `SELECT status,property_name,municipality,registration_number,total_area_hectares,cultivated_area_hectares,
            latitude_sede,longitude_sede,line_vicinal,rural_zone_sector,access_directions,water_source,irrigation_system,draft_data
       FROM public.app_properties WHERE id=$1 FOR UPDATE`,
    [propertyId],
  );
  const row = property.rows[0] ?? {};
  const status = String(row.status ?? "");
  const locked = !["draft", "completed", "rejected", "submitted"].includes(status);
  const clean = (value: string | null | undefined, max: number, min = 2) => {
    const text = value?.trim() ?? "";
    return text.length >= min ? text.slice(0, max) : null;
  };
  const sameNumber = (left: unknown, right: number | null) =>
    right != null && left != null && Number(left) === right;

  const nameOk = clean(input.propertyRegisteredName, 128);
  const cityOk = clean(input.municipality, 100);
  const registrationOk = clean(input.registrationNumber, 64, 1);
  const lineOk = clean(input.lineVicinal, 64);
  const zoneOk = clean(input.ruralZoneSector, 64);
  const accessOk = clean(input.accessDirections, 500, 1);
  const waterOk = ["poco_artesiano", "nascente_propria", "rio_corrego", "rede_tratada"].includes(input.waterSource ?? "")
    ? input.waterSource!
    : null;
  const irrigationOk = ["gotejamento", "microaspersao", "aspersao_convencional", "nenhum"].includes(input.irrigationSystem ?? "")
    ? input.irrigationSystem!
    : null;
  const activityOk = ["hortalicas_folhosas", "legumes_picados", "frutas_tropicais", "ervas_temperos", "misto"].includes(input.activityCategory ?? "")
    ? input.activityCategory!
    : null;
  const systemOk = ["organico_certificado", "agroecologico_declarado", "hidroponia", "convencional_transicao"].includes(input.productionSystem ?? "")
    ? input.productionSystem!
    : null;

  const currentTotal = row.total_area_hectares == null ? null : Number(row.total_area_hectares);
  const currentCultivated = row.cultivated_area_hectares == null ? null : Number(row.cultivated_area_hectares);
  const area =
    input.totalAreaHectares != null && Number.isFinite(input.totalAreaHectares) && input.totalAreaHectares > 0
      ? input.totalAreaHectares
      : null;
  const cultivatedCandidate =
    input.cultivatedAreaHectares != null && Number.isFinite(input.cultivatedAreaHectares) && input.cultivatedAreaHectares >= 0
      ? input.cultivatedAreaHectares
      : null;
  const areaCompatible =
    area != null &&
    ((cultivatedCandidate != null && cultivatedCandidate <= area) ||
      currentCultivated == null ||
      currentCultivated <= area);
  const areaApplied = !locked && areaCompatible && !sameNumber(row.total_area_hectares, area);
  const nextTotal = areaCompatible ? area : currentTotal;
  const cultivatedApplied =
    !locked &&
    cultivatedCandidate != null &&
    nextTotal != null &&
    cultivatedCandidate <= nextTotal &&
    !sameNumber(row.cultivated_area_hectares, cultivatedCandidate);

  const lat = input.latitudeSede;
  const lng = input.longitudeSede;
  const locationValid =
    lat != null && lng != null && lat >= -14 && lat <= -7 && lng >= -67 && lng <= -59;
  const locationApplied =
    !locked &&
    locationValid &&
    (!sameNumber(row.latitude_sede, lat) || !sameNumber(row.longitude_sede, lng));

  const directChanges: Array<[string, unknown]> = [];
  if (!locked && nameOk && nameOk !== String(row.property_name ?? "")) directChanges.push(["property_name", nameOk]);
  if (!locked && cityOk && cityOk !== String(row.municipality ?? "")) directChanges.push(["municipality", cityOk]);
  if (!locked && registrationOk && registrationOk !== String(row.registration_number ?? "")) directChanges.push(["registration_number", registrationOk]);
  if (!locked && lineOk && lineOk !== String(row.line_vicinal ?? "")) directChanges.push(["line_vicinal", lineOk]);
  if (!locked && zoneOk && zoneOk !== String(row.rural_zone_sector ?? "")) directChanges.push(["rural_zone_sector", zoneOk]);
  if (!locked && accessOk && accessOk !== String(row.access_directions ?? "")) directChanges.push(["access_directions", accessOk]);
  if (!locked && waterOk && waterOk !== String(row.water_source ?? "")) directChanges.push(["water_source", waterOk]);
  if (!locked && irrigationOk && irrigationOk !== String(row.irrigation_system ?? "")) directChanges.push(["irrigation_system", irrigationOk]);
  if (areaApplied && area != null) directChanges.push(["total_area_hectares", area]);
  if (cultivatedApplied && cultivatedCandidate != null) directChanges.push(["cultivated_area_hectares", cultivatedCandidate]);
  if (locationApplied) {
    directChanges.push(["latitude_sede", lat]);
    directChanges.push(["longitude_sede", lng]);
  }

  const currentDraft =
    row.draft_data && typeof row.draft_data === "object" && !Array.isArray(row.draft_data)
      ? (row.draft_data as Record<string, unknown>)
      : {};
  const nextDraft: Record<string, unknown> = { ...currentDraft };
  let draftChanged = false;
  const draftValue = (key: string, value: unknown) => {
    if (locked || value == null || value === "") return;
    if (nextDraft[key] !== value) {
      nextDraft[key] = value;
      draftChanged = true;
    }
  };
  draftValue("propertyName", nameOk);
  draftValue("municipality", cityOk);
  draftValue("registrationNumber", registrationOk);
  draftValue("lineVicinal", lineOk);
  draftValue("ruralZoneSector", zoneOk);
  draftValue("accessDirections", accessOk);
  if (areaCompatible && area != null) draftValue("totalAreaHectares", String(area));
  if (cultivatedCandidate != null && nextTotal != null && cultivatedCandidate <= nextTotal)
    draftValue("cultivatedAreaHectares", String(cultivatedCandidate));
  if (locationValid) {
    draftValue("latitudeSede", lat);
    draftValue("longitudeSede", lng);
    draftValue("state", "RO");
  }
  draftValue("waterSource", waterOk);
  draftValue("irrigationSystem", irrigationOk);
  draftValue("activityCategory", activityOk);
  draftValue("productionSystem", systemOk);
  if (typeof input.hasWashingFacility === "boolean") draftValue("hasWashingFacility", input.hasWashingFacility);

  const propertyUpdated = !locked && (directChanges.length > 0 || draftChanged);
  if (propertyUpdated) {
    const values: unknown[] = [propertyId];
    const sets = directChanges.map(([column, value]) => {
      values.push(value);
      return `${column}=$${values.length}`;
    });
    if (draftChanged) {
      values.push(JSON.stringify(nextDraft));
      sets.push(`draft_data=$${values.length}::jsonb`);
    }
    sets.push("updated_at=now()");
    await c.query(`UPDATE public.app_properties SET ${sets.join(",")} WHERE id=$1`, values);
  }

  let activityApplied = false;
  const washing = input.hasWashingFacility;
  const activityComplete =
    !locked &&
    activityOk != null &&
    systemOk != null &&
    typeof washing === "boolean" &&
    !(activityOk === "legumes_picados" && washing === false);
  if (activityComplete) {
    await c.query(
      `INSERT INTO public.app_rural_activities(property_id,activity_category,production_system,has_washing_facility)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(property_id) DO UPDATE
       SET activity_category=EXCLUDED.activity_category,
           production_system=EXCLUDED.production_system,
           has_washing_facility=EXCLUDED.has_washing_facility,
           updated_at=now()`,
      [propertyId, activityOk, systemOk, washing],
    );
    activityApplied = true;
  }

  return {
    propertyUpdated,
    areaApplied,
    cultivatedApplied,
    locationApplied,
    activityApplied,
    propertyStatus: status,
  };
}
export async function audit(
  c: PoolClient,
  a: DocumentActor,
  action: string,
  id: string,
  commandId?: string,
  details: Record<string, unknown> = {},
) {
  await c.query(
    `INSERT INTO public.app_audit_events(request_id,actor_id,actor_role,action,target_entity,target_id,payload_after,client_ip_hash,command_id) VALUES($1,$2,$3,$4,'app_documents',$5,$6,$7,$8)`,
    [
      a.requestId,
      a.userId,
      a.role,
      action,
      id,
      JSON.stringify(details),
      a.ipHash,
      commandId ?? null,
    ],
  );
}
export async function getDocument(
  a: DocumentActor,
  id: string,
  c: Pick<PoolClient, "query"> = pool(),
  lock = false,
) {
  const r = await c.query(
    `SELECT d.*,p.total_area_hectares,p.status AS property_status,pe.cpf_normalized FROM public.app_documents d JOIN public.app_properties p ON p.id=d.property_id JOIN public.app_producer_profiles pp ON pp.id=d.producer_id JOIN public.app_people pe ON pe.id=pp.person_id WHERE d.id=$1 AND ($2::boolean OR pe.user_id=$3) ${lock ? "FOR UPDATE OF d" : ""}`,
    [id, a.auditor, a.userId],
  );
  if (!r.rows[0]) throw new DocumentError("DOCUMENT_NOT_FOUND", 404);
  return r.rows[0];
}
export async function checkedBytes(doc: Record<string, any>) {
  const { data, error } = await storage().download(doc.storage_path);
  if (error || !data) throw new DocumentError("UPLOAD_NOT_RECEIVED", 409);
  if (data.size > 15728640) throw new DocumentError("FILE_TOO_LARGE", 413);
  return Buffer.from(await data.arrayBuffer());
}
export const DocumentStorageService = {
  async list(a: DocumentActor, propertyId: string) {
    const p = await pool().query(
      `SELECT p.id FROM public.app_properties p JOIN public.app_producer_profiles pp ON pp.id=p.producer_id JOIN public.app_people pe ON pe.id=pp.person_id WHERE p.id=$1 AND ($2::boolean OR pe.user_id=$3)`,
      [propertyId, a.auditor, a.userId],
    );
    if (!p.rows.length) throw new DocumentError("PROPERTY_NOT_FOUND", 404);
    const r = await pool().query(
      `SELECT id,property_id,document_type,file_name,file_size_bytes,mime_type,status,created_at FROM public.app_documents WHERE property_id=$1 AND ($2::boolean OR status<>'archived') ORDER BY created_at DESC LIMIT 100`,
      [propertyId, a.auditor],
    );
    return r.rows;
  },
  async requestUpload(a: DocumentActor, input: RequestUploadUrl) {
    if (a.auditor) throw new DocumentError("FORBIDDEN", 403);
    const doc = await transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.userId]);
      const p = await c.query(
        `SELECT p.id,p.producer_id,p.status FROM public.app_properties p JOIN public.app_producer_profiles pp ON pp.id=p.producer_id JOIN public.app_people pe ON pe.id=pp.person_id WHERE p.id=$1 AND pe.user_id=$2`,
        [input.propertyId, a.userId],
      );
      if (!p.rows[0]) throw new DocumentError("PROPERTY_NOT_FOUND", 404);
      if (p.rows[0].status === "suspended")
        throw new DocumentError("PROPERTY_SUSPENDED", 403);
      const replay = await c.query(
        "SELECT * FROM public.app_documents WHERE upload_command_id=$1",
        [input.commandId],
      );
      if (replay.rows[0]) {
        const d = replay.rows[0];
        if (
          d.uploaded_by !== a.userId ||
          d.property_id !== input.propertyId ||
          d.file_hash_sha256 !== input.fileHashSha256 ||
          d.document_type !== input.documentType ||
          Number(d.file_size_bytes) !== input.fileSizeBytes ||
          d.mime_type !== input.mimeType ||
          d.file_name !== input.fileName
        )
          throw new DocumentError("COMMAND_CONFLICT");
        return d;
      }
      const usage = await c.query(
        `SELECT count(*) FILTER(WHERE property_id=$1 AND status<>'archived')::int AS count,COALESCE(sum(file_size_bytes),0)::bigint AS bytes FROM public.app_documents WHERE producer_id=$2`,
        [input.propertyId, p.rows[0].producer_id],
      );
      if (
        usage.rows[0].count >= 20 ||
        Number(usage.rows[0].bytes) + input.fileSizeBytes > 157286400
      )
        throw new DocumentError("DOCUMENT_QUOTA_REACHED", 429);
      const id = randomUUID(),
        ext = {
          "application/pdf": "pdf",
          "image/png": "png",
          "image/jpeg": "jpg",
        }[input.mimeType];
      const r = await c.query(
        `INSERT INTO public.app_documents(id,property_id,producer_id,document_type,file_name,file_size_bytes,mime_type,storage_path,file_hash_sha256,uploaded_by,upload_command_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [
          id,
          input.propertyId,
          p.rows[0].producer_id,
          input.documentType,
          input.fileName,
          input.fileSizeBytes,
          input.mimeType,
          `properties/${input.propertyId}/${id}.${ext}`,
          input.fileHashSha256,
          a.userId,
          input.commandId,
        ],
      );
      await audit(c, a, "document.upload_requested", id, input.commandId);
      return r.rows[0];
    });
    if (doc.status !== "quarantine")
      return { documentId: doc.id, status: doc.status, signedUrl: null };
    const { data, error } = await storage().createSignedUploadUrl(
      doc.storage_path,
      { upsert: false },
    );
    if (error || !data) throw new DocumentError("STORAGE_UNAVAILABLE", 503);
    return {
      documentId: doc.id,
      status: doc.status,
      signedUrl: data.signedUrl,
    };
  },
  async confirm(a: DocumentActor, id: string, commandId: string) {
    const doc = await getDocument(a, id);
    if (a.auditor) throw new DocumentError("FORBIDDEN", 403);
    if (doc.status !== "quarantine") return { status: doc.status };
    const bytes = await checkedBytes(doc),
      scan = inspectDocument(bytes, doc);
    return transaction(async (c) => {
      const current = await getDocument(a, id, c, true);
      if (current.status !== "quarantine") return { status: current.status };
      await c.query(
        "INSERT INTO public.app_document_scans(document_id,is_clean,detected_mime,scan_details) VALUES($1,$2,$3,$4)",
        [
          id,
          scan.clean,
          scan.detectedMime ?? "unknown",
          JSON.stringify({
            hash: scan.hash,
            reason: scan.reason,
            scope: "signature_size_hash_active_pdf_not_antivirus",
          }),
        ],
      );
      const status = scan.clean ? "clean" : "rejected";
      await c.query(
        "UPDATE public.app_documents SET status=$2,updated_at=now() WHERE id=$1",
        [id, status],
      );
      await audit(c, a, "document.scanned", id, commandId, {
        status,
        reason: scan.reason,
      });
      return { status, reason: scan.reason };
    });
  },
  async download(a: DocumentActor, id: string) {
    return transaction(async (c) => {
      const doc = await getDocument(a, id, c, true);
      if (doc.status !== "clean")
        throw new DocumentError("DOCUMENT_NOT_AVAILABLE");
      const { data, error } = await storage().createSignedUrl(
        doc.storage_path,
        900,
      );
      if (error || !data) throw new DocumentError("STORAGE_UNAVAILABLE", 503);
      await audit(c, a, "document.viewed", id);
      return {
        signedUrl: data.signedUrl,
        expiresInSeconds: 900,
        mimeType: doc.mime_type,
        fileName: doc.file_name,
      };
    });
  },
  async file(a: DocumentActor, id: string) {
    const doc = await getDocument(a, id);
    if (doc.status !== "clean")
      throw new DocumentError("DOCUMENT_NOT_AVAILABLE");
    const bytes = await checkedBytes(doc);
    await pool().query(
      `INSERT INTO public.app_audit_events(request_id,actor_id,actor_role,action,target_entity,target_id,payload_after,client_ip_hash) VALUES($1,$2,$3,'document.previewed','app_documents',$4,$5,$6)`,
      [
        a.requestId,
        a.userId,
        a.role,
        id,
        JSON.stringify({ mime: doc.mime_type, bytes: bytes.length }),
        a.ipHash,
      ],
    );
    return {
      bytes,
      mimeType: String(doc.mime_type),
      fileName: String(doc.file_name || "documento"),
    };
  },
  async archive(a: DocumentActor, id: string, commandId: string) {
    return transaction(async (c) => {
      const d = await getDocument(a, id, c, true);
      if (a.auditor) throw new DocumentError("FORBIDDEN", 403);
      if (d.status === "archived") return { status: "archived" };
      await c.query(
        "UPDATE public.app_documents SET status='archived',updated_at=now() WHERE id=$1",
        [id],
      );
      await audit(c, a, "document.archived", id, commandId);
      return { status: "archived" };
    });
  },
  async declare(a: DocumentActor, id: string, input: ManualDocumentData) {
    if (a.auditor) throw new DocumentError("FORBIDDEN", 403);
    return transaction(async (c) => {
      const replay = await c.query(
        `SELECT payload_after FROM public.app_audit_events WHERE command_id=$1 AND actor_id=$2 AND action='document.declared'`,
        [input.commandId, a.userId],
      );
      if (replay.rows[0]?.payload_after) return replay.rows[0].payload_after;
      const doc = await getDocument(a, id, c, true);
      if (doc.status !== "clean")
        throw new DocumentError("DOCUMENT_NOT_AVAILABLE");
      if (!["car_sicar", "ccir_incra"].includes(doc.document_type))
        throw new DocumentError("EXTRACTION_TYPE_UNSUPPORTED", 422);
      const area = Math.round(input.totalAreaHectares * 10000) / 10000;
      const payload: ExtractionPayload = ExtractionSchema.parse({
        documentType: doc.document_type,
        carNumber: input.carNumber
          ? input.carNumber.toUpperCase().replace(/\s+/g, "").slice(0, 64)
          : null,
        ccirNumber: input.ccirNumber
          ? input.ccirNumber.replace(/\D/g, "").slice(0, 64)
          : null,
        sicarProtocol: null,
        propertyRegisteredName: input.propertyRegisteredName,
        holderName: input.holderName || null,
        holderCpfNormalized: input.holderCpfNormalized || null,
        municipality: input.municipality,
        state: "RO",
        latitudeSede: input.latitudeSede ?? null,
        longitudeSede: input.longitudeSede ?? null,
        lineVicinal: input.lineVicinal ?? null,
        ruralZoneSector: input.ruralZoneSector ?? null,
        accessDirections: input.accessDirections ?? null,
        totalAreaHectares: area,
        cultivatedAreaHectares: input.cultivatedAreaHectares ?? null,
        legalReserveHectares: input.legalReserveHectares ?? null,
        appHectares: input.appHectares ?? null,
        consolidatedRuralAreaHectares:
          input.consolidatedRuralAreaHectares ?? null,
        fiscalModules: input.fiscalModules ?? null,
        waterSource: input.waterSource ?? null,
        irrigationSystem: input.irrigationSystem ?? null,
        activityCategory: input.activityCategory ?? null,
        productionSystem: input.productionSystem ?? null,
        hasWashingFacility: input.hasWashingFacility ?? null,
        hasEmbargoOrInfractionDetected: null,
        confidenceScore: 1,
        fieldConfidence: {
          totalAreaHectares: 1,
          legalReserveHectares: 1,
          appHectares: 1,
          consolidatedRuralAreaHectares: 1,
          fiscalModules: 1,
        },
        rawText: "Declarado pelo produtor a partir do documento original, sem leitura automática.",
      });
      const check = validateExtraction(payload, {
        documentType: doc.document_type,
        cpf: doc.cpf_normalized,
        area,
      });
      let extraction = (
        await c.query(
          "SELECT * FROM public.app_document_extractions WHERE document_id=$1",
          [id],
        )
      ).rows[0];
      if (!extraction) {
        extraction = (
          await c.query(
            `INSERT INTO public.app_document_extractions(document_id,property_id,producer_id,extraction_engine,payload_jsonb,confidence_score,raw_text,status,file_hash_sha256,discrepancies,area_difference_percent) VALUES($1,$2,$3,'producer_manual',$4,1,$5,$6,$7,$8,$9) RETURNING *`,
            [
              id,
              doc.property_id,
              doc.producer_id,
              JSON.stringify(payload),
              payload.rawText,
              check.status,
              doc.file_hash_sha256,
              JSON.stringify(check.issues),
              check.areaDifferencePercent,
            ],
          )
        ).rows[0];
        await c.query(
          `INSERT INTO public.app_car_validations(extraction_id,property_id,car_number,ccir_number,total_area_ha,legal_reserve_ha,app_area_ha,fiscal_modules,validation_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'manual_check_required')`,
          [
            extraction.id,
            doc.property_id,
            payload.carNumber?.slice(0, 64) ?? null,
            payload.ccirNumber?.slice(0, 64) ?? null,
            payload.totalAreaHectares,
            payload.legalReserveHectares,
            payload.appHectares,
            payload.fiscalModules,
          ],
        );
      }
      const declaredNote =
        "Dados informados pelo produtor, sem leitura automática.\n" +
        JSON.stringify({
          carNumber: payload.carNumber,
          ccirNumber: payload.ccirNumber,
          propertyRegisteredName: payload.propertyRegisteredName,
          holderName: payload.holderName,
          holderCpfNormalized: payload.holderCpfNormalized,
          municipality: payload.municipality,
          lineVicinal: payload.lineVicinal,
          ruralZoneSector: payload.ruralZoneSector,
          accessDirections: payload.accessDirections,
          totalAreaHectares: payload.totalAreaHectares,
          cultivatedAreaHectares: payload.cultivatedAreaHectares,
          legalReserveHectares: payload.legalReserveHectares,
          appHectares: payload.appHectares,
          consolidatedRuralAreaHectares: payload.consolidatedRuralAreaHectares,
          fiscalModules: payload.fiscalModules,
          latitudeSede: payload.latitudeSede,
          longitudeSede: payload.longitudeSede,
          waterSource: payload.waterSource,
          irrigationSystem: payload.irrigationSystem,
          activityCategory: payload.activityCategory,
          productionSystem: payload.productionSystem,
          hasWashingFacility: payload.hasWashingFacility,
        });
      await c.query(
        "INSERT INTO public.app_document_reviews(extraction_id,user_id,decision,note,command_id) VALUES($1,$2,'confirmed',$3,$4)",
        [extraction.id, a.userId, declaredNote, input.commandId],
      );
      const applied = await applyExtractedProperty(c, doc.property_id, {
        propertyRegisteredName: input.propertyRegisteredName,
        municipality: input.municipality,
        registrationNumber: payload.carNumber ?? payload.ccirNumber,
        totalAreaHectares: area,
        latitudeSede: input.latitudeSede ?? null,
        longitudeSede: input.longitudeSede ?? null,
        lineVicinal: input.lineVicinal ?? null,
        ruralZoneSector: input.ruralZoneSector ?? null,
        accessDirections: input.accessDirections ?? null,
        cultivatedAreaHectares:
          input.cultivatedAreaHectares ??
          input.consolidatedRuralAreaHectares ??
          null,
        waterSource: input.waterSource ?? null,
        irrigationSystem: input.irrigationSystem ?? null,
        activityCategory: input.activityCategory ?? null,
        productionSystem: input.productionSystem ?? null,
        hasWashingFacility: input.hasWashingFacility ?? null,
      });
      const result = {
        extraction,
        propertyUpdated: applied.propertyUpdated,
        areaApplied: applied.areaApplied,
        propertyStatus: applied.propertyStatus,
        discrepancies: check.issues,
      };
      await audit(c, a, "document.declared", id, input.commandId, {
        propertyUpdated: result.propertyUpdated,
        areaApplied: applied.areaApplied,
        propertyStatus: applied.propertyStatus,
        engine: extraction.extraction_engine,
      });
      return result;
    });
  },
};
