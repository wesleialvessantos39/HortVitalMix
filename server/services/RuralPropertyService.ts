import type { PoolClient } from "pg";
import { dbPool } from "../db/pool.ts";
import { redactPII } from "../security/redactPII.ts";
import type {
  SaveRuralDraftInput,
  RuralPropertyView,
  SaveWizardStepInput,
  SubmitPropertyInput,
} from "../../shared/contracts/ruralProperty.ts";

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
async function mapProperty(
  client: PoolClient,
  row: Record<string, any>,
): Promise<RuralPropertyView> {
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
    ruralZoneSector: row.rural_zone_sector,
    lineVicinal: row.line_vicinal,
    municipality: row.municipality,
    state: row.state,
    latitudeSede: row.latitude_sede === null ? null as unknown as number : Number(row.latitude_sede),
    longitudeSede: row.longitude_sede === null ? null as unknown as number : Number(row.longitude_sede),
    accessDirections: row.access_directions,
    waterSource: row.water_source,
    irrigationSystem: row.irrigation_system,
    status: row.status,
    wizardCurrentStep: row.wizard_current_step,
    revision: row.revision,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    boundaries: await loadBoundaries(client, row.id),
    activity: await loadActivity(client, row.id),
  };
}

function assertEditable(row: Record<string,any>) {
 if(row.status==="suspended")throw new RuralPropertyError("PROPERTY_NOT_EDITABLE",409);
}

function assertRevision(row: Record<string, any>, expected?: number) {
  if (typeof expected !== "number" || row.revision !== expected)
    throw new RuralPropertyError(
      "PROPERTY_REVISION_CONFLICT",
      409,
      "O imóvel foi alterado em outra sessão.",
    );
}

async function assertComplete(client: PoolClient, row: Record<string, any>) {
  if (
    !row.property_name || !row.line_vicinal || !row.rural_zone_sector || row.latitude_sede === null || row.longitude_sede === null ||
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
      "SET wizard_current_step=5,status=$3,draft_data=NULL,completed_at=COALESCE(completed_at,now())",
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
          const current=await lockProperty(client,producerId,input.propertyId);assertEditable(current);assertRevision(current,input.expectedRevision);
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
  static async deleteDraft(userId:string,propertyId:string,expectedRevision:number,commandId:string,requestId:string,ipHash:string){
    const client=await requirePool().connect();
    try{
      await client.query("BEGIN");const producerId=await resolveProducer(client,userId,true);
      const replay=await replayTarget(client,commandId,userId,"rural_property.draft_deleted");
      if(!replay){
        const row=await lockProperty(client,producerId,propertyId);assertRevision(row,expectedRevision);
        if(row.status!=="draft" || row.completed_at)throw new RuralPropertyError("COMPLETED_PROPERTY_DELETE_FORBIDDEN",409);
        if ((await client.query("SELECT 1 FROM public.app_documents WHERE property_id=$1 LIMIT 1",[propertyId])).rows.length) throw new RuralPropertyError("PROPERTY_HAS_DOCUMENTS",409,"Este imóvel possui documentos com histórico de custódia e não pode ser excluído.");
        await audit(client,{userId,role:"producer",requestId,ipHash,commandId,action:"rural_property.draft_deleted",targetId:propertyId,before:summaryMetadata(row)});
        await client.query("DELETE FROM public.app_properties WHERE id=$1 AND producer_id=$2",[propertyId,producerId]);
      }
      await client.query("COMMIT");
    }catch(e){await client.query("ROLLBACK");mapDbError(e);}finally{client.release();}
  }
  static async listProperties(userId: string) {
    const client = await requirePool().connect();
    try {
      const producerId = await resolveProducer(client, userId);
      const result = await client.query<Record<string, any>>(
        [
          "SELECT id,property_name,line_vicinal,municipality,state,status,",
          "wizard_current_step,revision,updated_at,completed_at,draft_data",
          "FROM public.app_properties",
          "WHERE producer_id=$1",
          "ORDER BY updated_at DESC,id ASC",
        ].join(" "),
        [producerId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        propertyName: shownPropertyName(row),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    draftData: row.draft_data,
        lineVicinal: row.line_vicinal,
        municipality: row.municipality,
        state: row.state,
        status: row.status,
        wizardCurrentStep: row.wizard_current_step,
        revision: row.revision,
        updatedAt: new Date(row.updated_at).toISOString(),
      }));
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
          nextStep: Math.min(5, input.step + 1),
        };
      }

      let propertyId = input.propertyId;
      let before: Record<string, any> | null = null;
      let row: Record<string, any>;

      if (input.step === 1 && !propertyId) {
        const data = input.stepData;
        const inserted = await client.query<Record<string, any>>(
          [
            "INSERT INTO public.app_properties",
            "(producer_id,property_name,registration_number,rural_zone_sector,",
            "line_vicinal,municipality,state,latitude_sede,longitude_sede,",
            "access_directions,wizard_current_step)",
            "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1)",
            "RETURNING *",
          ].join(" "),
          [
            producerId,
            data.propertyName,
            data.registrationNumber || null,
            data.ruralZoneSector,
            data.lineVicinal,
            data.municipality,
            data.state,
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
        assertEditable(current);
        assertRevision(current, input.expectedRevision);
        if(input.step<5 && current.status!=="draft") {
          await client.query("UPDATE public.app_properties SET status='draft' WHERE id=$1 AND producer_id=$2",[propertyId,producerId]);
        }

        if (input.step === 1) {
          const data = input.stepData;
          row = (
            await client.query<Record<string, any>>(
              [
                "UPDATE public.app_properties SET",
                "draft_data=NULL,property_name=$1,registration_number=$2,rural_zone_sector=$3,",
                "line_vicinal=$4,municipality=$5,state=$6,latitude_sede=$7,",
                "longitude_sede=$8,access_directions=$9,",
                "wizard_current_step=GREATEST(wizard_current_step,1)",
                "WHERE id=$10 AND producer_id=$11 RETURNING *",
              ].join(" "),
              [
                data.propertyName,
                data.registrationNumber || null,
                data.ruralZoneSector,
                data.lineVicinal,
                data.municipality,
                data.state,
                data.latitudeSede,
                data.longitudeSede,
                data.accessDirections || null,
                propertyId,
                producerId,
              ],
            )
          ).rows[0];
        } else if (input.step === 2) {
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
                "wizard_current_step=GREATEST(wizard_current_step,2)",
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
        } else if (input.step === 3) {
          const data = input.stepData;
          row = (
            await client.query<Record<string, any>>(
              [
                "UPDATE public.app_properties SET",
                "water_source=$1,irrigation_system=$2,",
                "wizard_current_step=GREATEST(wizard_current_step,3)",
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
        } else if (input.step === 4) {
          const data = input.stepData;
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
              data.activityCategory,
              data.productionSystem,
              data.hasWashingFacility,
            ],
          );
          row = (
            await client.query<Record<string, any>>(
              [
                "UPDATE public.app_properties SET",
                "wizard_current_step=GREATEST(wizard_current_step,4)",
                "WHERE id=$1 AND producer_id=$2 RETURNING *",
              ].join(" "),
              [propertyId, producerId],
            )
          ).rows[0];
        } else {
          if(current.draft_data)throw new RuralPropertyError("PROPERTY_INCOMPLETE",422);
          await assertComplete(client, current);
          row = await transitionToSubmitted(client, producerId, current, input.completeOnly);
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
            input.step === 5
              ? input.stepData.agroecologicalCommitment
              : undefined,
        },
        ipHash,
        commandId: input.commandId,
      });

      const property = await mapProperty(client, row);
      await client.query("COMMIT");
      return {
        status: input.step === 5 ? (input.completeOnly ? "completed" as const : "submitted" as const) : ("step_saved" as const),
        property,
        nextStep: Math.min(5, input.step + 1),
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

      assertEditable(current);
      assertRevision(current, input.expectedRevision);
      if(current.draft_data)throw new RuralPropertyError("PROPERTY_INCOMPLETE",422);
      await assertComplete(client, current);
      const documents = await client.query<{ id: string; extraction_id: string | null }>(
        `SELECT d.id, e.id AS extraction_id FROM public.app_documents d LEFT JOIN public.app_document_extractions e ON e.document_id=d.id WHERE d.property_id=$1 AND d.status='clean' AND d.document_type IN ('car_sicar','ccir_incra')`,
        [propertyId],
      );
      if (!documents.rows.length)
        throw new RuralPropertyError(
          "PROPERTY_DOCUMENTS_REQUIRED",
          422,
          "Envie o CAR ou o CCIR conferido antes da análise.",
        );
      if (!documents.rows.some((row) => row.extraction_id))
        throw new RuralPropertyError(
          "PROPERTY_DOCUMENT_DATA_REQUIRED",
          422,
          "Informe os dados do documento antes de enviar para análise.",
        );

      const row = await transitionToSubmitted(
        client,
        producerId,
        current,
      );

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
          documents: documents.rows.map((row) => ({
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
}
