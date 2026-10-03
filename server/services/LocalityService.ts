import type { PoolClient } from "pg";
import { dbPool } from "../db/pool.ts";
import { reportFailure } from "../config/reportFailure.ts";
import { redactPII } from "../security/redactPII.ts";
import {
  LOCALITY_DISABLED_MESSAGE,
  LOCALITY_NOT_COVERED_MESSAGE,
  type LocalityCoverage,
  type Municipality,
} from "../../shared/contracts/locality.ts";
import { findRoMunicipality } from "../../shared/localities/roMunicipalities.ts";

export class LocalityError extends Error {
  constructor(
    public code: string,
    public status: number,
    message = code,
  ) {
    super(message);
    this.name = "LocalityError";
  }
}

function requirePool() {
  if (!dbPool) throw new LocalityError("UNAVAILABLE", 503);
  return dbPool;
}

export function mapMunicipality(row: Record<string, any>): Municipality {
  return {
    id: row.id,
    ibgeCode: row.ibge_code,
    name: row.name,
    state: row.state,
    isActive: row.is_active,
    revision: row.revision,
  };
}

/**
 * Mensagem pública canônica de bloqueio por cobertura.
 * `inactive` (município desativado pelo Super administrador) tem texto literal
 * exigido pelo proprietário; `unknown` é ausência de cobertura.
 */
export function coverageMessage(coverage: LocalityCoverage): string {
  return coverage === "inactive"
    ? LOCALITY_DISABLED_MESSAGE
    : LOCALITY_NOT_COVERED_MESSAGE;
}

export function isCoverageBlocking(coverage: LocalityCoverage): boolean {
  return coverage !== "active";
}

async function writeAudit(
  client: PoolClient,
  args: {
    requestId: string;
    actorId: string | null;
    actorRole: string;
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
      "VALUES($1,$2,$3,$4,'app_municipalities',$5,$6,$7,$8,$9)",
    ].join(" "),
    [
      args.requestId,
      args.actorId,
      args.actorRole,
      args.action,
      args.targetId,
      args.before ? JSON.stringify(redactPII(args.before)) : null,
      args.after ? JSON.stringify(redactPII(args.after)) : null,
      args.ipHash,
      args.commandId,
    ],
  );
}

/** Idempotência por comando: a auditoria é o livro-razão da intenção. */
async function replayedTarget(
  client: PoolClient,
  commandId: string,
  actions: string[],
) {
  const result = await client.query<{ target_id: string | null }>(
    "SELECT target_id FROM public.app_audit_events WHERE command_id=$1 AND action = ANY($2::text[]) LIMIT 1",
    [commandId, actions],
  );
  return result.rows[0]?.target_id ?? null;
}

function mapDbError(error: unknown): never {
  const code = (error as { code?: string })?.code;
  if (code === "23505") throw new LocalityError("DUPLICATE", 409);
  if (code === "23514" || code === "23502" || code === "22P02")
    throw new LocalityError("VALIDATION_FAILED", 422);
  throw new LocalityError("UNAVAILABLE", 503);
}

export const LocalityService = {
  /** Catálogo de municípios. Leitura pública: a vitrine consulta sem sessão. */
  async listMunicipalities(includeInactive = false) {
    const pool = requirePool();
    const result = await pool.query<Record<string, any>>(
      [
        "SELECT id,ibge_code,name,state,is_active,revision",
        "  FROM public.app_municipalities",
        includeInactive
          ? " ORDER BY is_active DESC, name ASC"
          : " WHERE is_active ORDER BY name ASC",
      ].join(" "),
    );
    const municipalities = result.rows.map(mapMunicipality);
    return {
      municipalities,
      activeMunicipalityIds: municipalities
        .filter((row) => row.isActive)
        .map((row) => row.id),
    };
  },

  /** Catálogo completo para a gestão do Super administrador (inclui inativos). */
  async listAdminMunicipalities() {
    const result = await requirePool().query<Record<string, any>>(
      [
        "SELECT id,ibge_code,name,state,is_active,revision,created_at,updated_at,deactivated_at",
        "  FROM public.app_municipalities",
        " ORDER BY is_active DESC, state ASC, name ASC",
      ].join(" "),
    );
    return {
      municipalities: result.rows.map((row) => ({
        ...mapMunicipality(row),
        deactivatedAt: row.deactivated_at
          ? new Date(row.deactivated_at).toISOString()
          : null,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      })),
      activeMunicipalityIds: result.rows
        .filter((row) => row.is_active)
        .map((row) => row.id),
    };
  },

  async findMunicipality(municipalityId: string) {
    const result = await requirePool().query<Record<string, any>>(
      "SELECT id,is_active FROM public.app_municipalities WHERE id=$1",
      [municipalityId],
    );
    return result.rows[0] ?? null;
  },

  /** Cobertura de um município por UF + nome. Nunca lança por ausência. */
  async resolveCoverage(state: string, name: string) {
    const pool = requirePool();
    const result = await pool.query<{
      id: string;
      name: string;
      state: string;
      coverage: LocalityCoverage;
    }>(
      [
        "SELECT m.id, m.name, m.state,",
        "       CASE WHEN m.is_active THEN 'active' ELSE 'inactive' END AS coverage",
        "  FROM public.app_municipalities m",
        " WHERE m.state = upper($1)",
        "   AND m.name_normalized = public.fn_locality_normalize($2)",
        " LIMIT 1",
      ].join(" "),
      [state, name],
    );
    const row = result.rows[0];
    const coverage = (row?.coverage ?? "unknown") as LocalityCoverage;
    return {
      coverage,
      municipality: row
        ? { id: row.id, name: row.name, state: row.state }
        : null,
      message: isCoverageBlocking(coverage) ? coverageMessage(coverage) : null,
    };
  },

  /**
   * Trava operacional: lança quando o município não está cadastrado ou está
   * desativado. Devolve o id canônico do município quando há cobertura ativa.
   */
  async assertOperational(state: string, name: string) {
    const resolved = await this.resolveCoverage(state, name);
    if (isCoverageBlocking(resolved.coverage))
      throw new LocalityError(
        resolved.coverage === "inactive"
          ? "LOCALITY_DISABLED"
          : "LOCALITY_NOT_COVERED",
        resolved.coverage === "inactive" ? 403 : 422,
        resolved.message ?? coverageMessage(resolved.coverage),
      );
    return resolved.municipality!.id;
  },

  async createMunicipality(
    input: {
      ibgeCode: string;
      name: string;
      state: string;
      commandId: string;
    },
    actor: { userId: string; role: string },
    requestId: string,
    ipHash: string,
  ) {
    const canonicalMunicipality = findRoMunicipality({
      name: input.name,
      ibgeCode: input.ibgeCode,
    });
    if (
      input.state !== "RO" ||
      !canonicalMunicipality
    )
      throw new LocalityError("VALIDATION_FAILED", 422);
    const client = await requirePool().connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('app_municipalities'))",
      );

      const replayTarget = await replayedTarget(client, input.commandId, [
        "locality.municipality_created",
      ]);
      if (replayTarget) {
        const replay = await client.query<Record<string, any>>(
          "SELECT * FROM public.app_municipalities WHERE id=$1",
          [replayTarget],
        );
        await client.query("COMMIT");
        if (replay.rows[0])
          return {
            status: "created" as const,
            municipality: mapMunicipality(replay.rows[0]),
          };
        return { status: "duplicate" as const };
      }

      const duplicate = await client.query(
        [
          "SELECT 1 FROM public.app_municipalities",
          " WHERE ibge_code=$1",
          "    OR (state=upper($2) AND name_normalized=public.fn_locality_normalize($3))",
          " LIMIT 1",
        ].join(" "),
        [input.ibgeCode, input.state, input.name],
      );
      if (duplicate.rows[0]) {
        await client.query("COMMIT");
        return { status: "duplicate" as const };
      }

      const inserted = await client.query<Record<string, any>>(
        [
          "INSERT INTO public.app_municipalities(ibge_code,name,state,created_by,updated_by)",
          "VALUES($1,$2,upper($3),$4,$4) RETURNING *",
        ].join(" "),
        [
          canonicalMunicipality.ibgeCode,
          canonicalMunicipality.name,
          input.state,
          actor.userId,
        ],
      );
      const row = inserted.rows[0];

      // Se a cobertura foi removida anteriormente, o recadastro do mesmo
      // município reconecta automaticamente as pessoas afetadas.
      await client.query(
        `UPDATE public.app_people p
            SET municipality_id=$1,updated_at=clock_timestamp(),revision=revision+1
          WHERE p.municipality_id IS NULL
            AND p.user_id IN (
              SELECT i.user_id
                FROM public.app_locality_user_impacts i
               WHERE i.resolved_at IS NULL
                 AND i.state=$2
                 AND i.locality_name_normalized=public.fn_locality_normalize($3)
            )`,
        [row.id,row.state,row.name],
      );
      await client.query(
        `UPDATE public.app_locality_user_impacts
            SET resolved_at=clock_timestamp()
          WHERE resolved_at IS NULL
            AND state=$1
            AND locality_name_normalized=public.fn_locality_normalize($2)`,
        [row.state,row.name],
      );

      await writeAudit(client, {
        requestId,
        actorId: actor.userId,
        actorRole: actor.role,
        action: "locality.municipality_created",
        targetId: row.id,
        after: { ibge_code: row.ibge_code, name: row.name, state: row.state },
        ipHash,
        commandId: input.commandId,
      });

      await client.query("COMMIT");
      return { status: "created" as const, municipality: mapMunicipality(row) };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      if (error instanceof LocalityError) throw error;
      mapDbError(error);
    } finally {
      client.release();
    }
  },

  async updateMunicipality(
    municipalityId: string,
    input: {
      isActive?: boolean;
      name?: string;
      expectedRevision: number;
      commandId: string;
    },
    actor: { userId: string; role: string },
    requestId: string,
    ipHash: string,
  ) {
    const client = await requirePool().connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<Record<string, any>>(
        "SELECT * FROM public.app_municipalities WHERE id=$1 FOR UPDATE",
        [municipalityId],
      );
      const current = locked.rows[0];
      if (!current) {
        await client.query("ROLLBACK");
        return { status: "not_found" as const };
      }
      if (
        input.name &&
        (current.state !== "RO" ||
          !findRoMunicipality({
            name: input.name,
            ibgeCode: current.ibge_code,
          }))
      ) {
        await client.query("ROLLBACK");
        throw new LocalityError("VALIDATION_FAILED", 422);
      }
      const canonicalName = input.name
        ? findRoMunicipality({
            name: input.name,
            ibgeCode: current.ibge_code,
          })?.name
        : undefined;

      const replayTarget = await replayedTarget(client, input.commandId, [
        "locality.municipality_updated",
        "locality.municipality_deactivated",
      ]);
      if (replayTarget === municipalityId) {
        await client.query("COMMIT");
        return {
          status: "updated" as const,
          municipality: mapMunicipality(current),
        };
      }

      if (current.revision !== input.expectedRevision) {
        await client.query("ROLLBACK");
        return {
          status: "conflict" as const,
          currentRevision: current.revision as number,
        };
      }

      const nextActive = input.isActive ?? current.is_active;
      const deactivating = current.is_active && !nextActive;

      const updated = await client.query<Record<string, any>>(
        [
          "UPDATE public.app_municipalities SET",
          "  name=coalesce($2,name),",
          "  is_active=$3,",
          "  deactivated_at=CASE WHEN $3 THEN NULL ELSE coalesce(deactivated_at,clock_timestamp()) END,",
          "  deactivated_by=CASE WHEN $3 THEN NULL ELSE coalesce(deactivated_by,$4) END,",
          "  updated_by=$4,",
          "  revision=revision+1",
          " WHERE id=$1 RETURNING *",
        ].join(" "),
        [municipalityId, canonicalName ?? null, nextActive, actor.userId],
      );
      const row = updated.rows[0];

      await writeAudit(client, {
        requestId,
        actorId: actor.userId,
        actorRole: actor.role,
        action: deactivating
          ? "locality.municipality_deactivated"
          : "locality.municipality_updated",
        targetId: row.id,
        before: {
          name: current.name,
          is_active: current.is_active,
          revision: current.revision,
        },
        after: {
          name: row.name,
          is_active: row.is_active,
          revision: row.revision,
        },
        ipHash,
        commandId: input.commandId,
      });

      await client.query("COMMIT");
      return { status: "updated" as const, municipality: mapMunicipality(row) };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      if (error instanceof LocalityError) throw error;
      mapDbError(error);
    } finally {
      client.release();
    }
  },

  async deleteMunicipality(
    municipalityId: string,
    input: { expectedRevision: number; commandId: string },
    actor: { userId: string; role: string },
    requestId: string,
    ipHash: string,
  ) {
    const client = await requirePool().connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('app_municipalities'))",
      );

      const replayTarget = await replayedTarget(client,input.commandId,[
        "locality.municipality_deleted",
      ]);
      if (replayTarget === municipalityId) {
        await client.query("COMMIT");
        return { status: "deleted" as const, municipalityId };
      }

      const locked = await client.query<Record<string,any>>(
        "SELECT * FROM public.app_municipalities WHERE id=$1 FOR UPDATE",
        [municipalityId],
      );
      const current = locked.rows[0];
      if (!current) {
        await client.query("ROLLBACK");
        return { status: "not_found" as const };
      }
      if (current.revision !== input.expectedRevision) {
        await client.query("ROLLBACK");
        return {
          status: "conflict" as const,
          currentRevision: current.revision as number,
        };
      }

      const impactRow = await client.query<Record<string,string>>(
        `SELECT
           (SELECT count(*)::text FROM public.app_people WHERE municipality_id=$1) AS people,
           (SELECT count(*)::text
              FROM public.app_properties p
             WHERE p.state=$2
               AND public.fn_locality_normalize(p.municipality)=$3
               AND p.status<>'withdrawn') AS properties,
           (SELECT count(*)::text FROM public.app_producer_delivery_municipalities WHERE municipality_id=$1) AS deliveries,
           (SELECT count(*)::text FROM public.app_access_partial_block_municipalities WHERE municipality_id=$1) AS blocks`,
        [municipalityId,current.state,current.name_normalized],
      );
      const measured = impactRow.rows[0] ?? {};
      const impact = {
        municipalityId,
        isActive: Boolean(current.is_active),
        people: Number(measured.people ?? 0),
        properties: Number(measured.properties ?? 0),
        deliveryScopes: Number(measured.deliveries ?? 0),
        partialBlocks: Number(measured.blocks ?? 0),
      };

      await client.query(
        `INSERT INTO public.app_locality_user_impacts(
             user_id,locality_name,locality_name_normalized,state
           )
           SELECT p.user_id,$2,$3,$4
             FROM public.app_people p
            WHERE p.municipality_id=$1
              AND p.user_id IS NOT NULL
           ON CONFLICT(user_id,locality_name_normalized,state)
             WHERE resolved_at IS NULL
           DO NOTHING`,
        [municipalityId,current.name,current.name_normalized,current.state],
      );

      await writeAudit(client,{
        requestId,
        actorId: actor.userId,
        actorRole: actor.role,
        action: "locality.municipality_deleted",
        targetId: municipalityId,
        before: {
          ibge_code: current.ibge_code,
          name: current.name,
          state: current.state,
          is_active: current.is_active,
          revision: current.revision,
        },
        after: { deleted: true, impact },
        ipHash,
        commandId: input.commandId,
      });

      await client.query(
        "DELETE FROM public.app_municipalities WHERE id=$1",
        [municipalityId],
      );
      await client.query("COMMIT");
      return { status: "deleted" as const, municipalityId, impact };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      if (error instanceof LocalityError) throw error;
      mapDbError(error);
    } finally {
      client.release();
    }
  },

  /** Impacto medido de desativar um município — usado no aviso de confirmação. */
  async deactivationImpact(municipalityId: string) {
    const pool = requirePool();
    const [people, properties, deliveries, blocks] = await Promise.all([
      pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM public.app_people WHERE municipality_id=$1",
        [municipalityId],
      ),
      pool.query<{ count: string }>(
        [
          "SELECT count(*)::text AS count",
          "  FROM public.app_properties p",
          "  JOIN public.app_municipalities m",
          "    ON m.state=p.state AND m.name_normalized=public.fn_locality_normalize(p.municipality)",
          " WHERE m.id=$1 AND p.status<>'withdrawn'",
        ].join(" "),
        [municipalityId],
      ),
      pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM public.app_producer_delivery_municipalities WHERE municipality_id=$1",
        [municipalityId],
      ),
      pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM public.app_access_partial_block_municipalities WHERE municipality_id=$1",
        [municipalityId],
      ),
    ]);
    return {
      people: Number(people.rows[0]?.count ?? 0),
      properties: Number(properties.rows[0]?.count ?? 0),
      deliveryScopes: Number(deliveries.rows[0]?.count ?? 0),
      partialBlocks: Number(blocks.rows[0]?.count ?? 0),
    };
  },
};

export function localityFailure(error: unknown, requestId: string) {
  if (error instanceof LocalityError)
    return { status: error.status, error: error.code, message: error.message };
  reportFailure("locality_operation_failed", requestId);
  return { status: 503, error: "UNAVAILABLE", message: "UNAVAILABLE" };
}
