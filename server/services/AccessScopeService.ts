import type { PoolClient } from "pg";
import { dbPool } from "../db/pool.ts";
import { reportFailure } from "../config/reportFailure.ts";
import { redactPII } from "../security/redactPII.ts";
import type {
  DeliveryScopeMode,
  PartialBlock,
  PartialBlockScope,
  PartialBlockSubject,
  ProducerDeliveryScope,
} from "../../shared/contracts/locality.ts";

export class AccessScopeError extends Error {
  constructor(
    public code: string,
    public status: number,
    message = code,
  ) {
    super(message);
    this.name = "AccessScopeError";
  }
}

function requirePool() {
  if (!dbPool) throw new AccessScopeError("UNAVAILABLE", 503);
  return dbPool;
}

async function resolveProducerId(
  client: PoolClient,
  userId: string,
  lock = false,
) {
  const result = await client.query<{ id: string }>(
    [
      "SELECT pp.id",
      "  FROM public.app_producer_profiles pp",
      "  JOIN public.app_people pe ON pe.id=pp.person_id",
      " WHERE pe.user_id=$1",
      lock ? " FOR UPDATE OF pp" : "",
    ].join(" "),
    [userId],
  );
  if (!result.rows[0])
    throw new AccessScopeError("PRODUCER_PROFILE_REQUIRED", 403);
  return result.rows[0].id;
}

async function writeAudit(
  client: PoolClient,
  args: {
    requestId: string;
    actorId: string;
    actorRole: string;
    action: string;
    targetEntity: string;
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
      "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    ].join(" "),
    [
      args.requestId,
      args.actorId,
      args.actorRole,
      args.action,
      args.targetEntity,
      args.targetId,
      args.before ? JSON.stringify(redactPII(args.before)) : null,
      args.after ? JSON.stringify(redactPII(args.after)) : null,
      args.ipHash,
      args.commandId,
    ],
  );
}

function mapDbError(error: unknown): never {
  const code = (error as { code?: string })?.code;
  if (code === "23505") throw new AccessScopeError("ALREADY_ACTIVE", 409);
  if (code === "23503") throw new AccessScopeError("VALIDATION_FAILED", 422);
  if (code === "23514" || code === "22P02")
    throw new AccessScopeError("VALIDATION_FAILED", 422);
  throw new AccessScopeError("UNAVAILABLE", 503);
}

export function producerIsApproved(verificationStatus: string | null | undefined) {
  return verificationStatus === "verified";
}

async function assertProducerApproved(client: PoolClient, producerId: string) {
  const result = await client.query<{ verification_status: string }>(
    "SELECT verification_status FROM public.app_producer_profiles WHERE id=$1",
    [producerId],
  );
  if (!producerIsApproved(result.rows[0]?.verification_status))
    throw new AccessScopeError(
      "PRODUCER_NOT_APPROVED",
      403,
      "A loja e a publicação de produtos dependem da aprovação do imóvel.",
    );
}

function mapPartialBlock(
  row: Record<string, any>,
  municipalityIds: string[],
  propertyIds: string[],
): PartialBlock {
  return {
    id: row.id,
    userId: row.user_id,
    subject: row.subject as PartialBlockSubject,
    scope: row.scope as PartialBlockScope,
    reason: row.reason,
    isActive: row.is_active,
    municipalityIds,
    propertyIds,
    createdAt: new Date(row.created_at).toISOString(),
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
  };
}

async function loadBlockChildren(
  client: PoolClient,
  blockIds: string[],
): Promise<{ municipalities: Map<string, string[]>; properties: Map<string, string[]> }> {
  const municipalities = new Map<string, string[]>();
  const properties = new Map<string, string[]>();
  if (!blockIds.length) return { municipalities, properties };

  const [mun, prop] = await Promise.all([
    client.query<{ block_id: string; municipality_id: string }>(
      "SELECT block_id,municipality_id FROM public.app_access_partial_block_municipalities WHERE block_id=ANY($1::uuid[])",
      [blockIds],
    ),
    client.query<{ block_id: string; property_id: string }>(
      "SELECT block_id,property_id FROM public.app_access_partial_block_properties WHERE block_id=ANY($1::uuid[])",
      [blockIds],
    ),
  ]);
  for (const row of mun.rows)
    municipalities.set(row.block_id, [
      ...(municipalities.get(row.block_id) ?? []),
      row.municipality_id,
    ]);
  for (const row of prop.rows)
    properties.set(row.block_id, [
      ...(properties.get(row.block_id) ?? []),
      row.property_id,
    ]);
  return { municipalities, properties };
}

export const AccessScopeService = {
  /**
   * Estado efetivo de publicação do produtor em um município.
   * Combina cobertura ativa, escopo de entrega declarado e bloqueio parcial.
   */
  async canPublishIn(userId: string, municipalityId: string) {
    const pool = requirePool();
    const result = await pool.query<{
      coverage: string;
      delivers: boolean | null;
      blocked: boolean;
      block_kind: string;
      verification_status: string | null;
    }>(
      [
        "SELECT public.fn_locality_coverage_by_id($2::uuid) AS coverage,",
        "       public.fn_producer_delivers_to(",
        "         (SELECT pp.id FROM public.app_producer_profiles pp",
        "            JOIN public.app_people pe ON pe.id=pp.person_id",
        "           WHERE pe.user_id=$1::uuid LIMIT 1), $2::uuid) AS delivers,",
        "       (SELECT pp.verification_status FROM public.app_producer_profiles pp",
        "          JOIN public.app_people pe ON pe.id=pp.person_id",
        "         WHERE pe.user_id=$1::uuid LIMIT 1) AS verification_status,",
        "       public.fn_is_publish_blocked($1::uuid,$2::uuid) AS blocked,",
        "       public.fn_partial_block_kind($1::uuid,'producer_publishing') AS block_kind",
      ].join(" "),
      [userId, municipalityId],
    );
    const row = result.rows[0];
    const coverage = row?.coverage ?? "unknown";
    const blocked = Boolean(row?.blocked) || row?.block_kind === "all";
    const approved = producerIsApproved(row?.verification_status);
    const reason = blocked
      ? "PARTIAL_BLOCK"
      : !approved
        ? "PRODUCER_NOT_APPROVED"
      : coverage !== "active"
        ? coverage === "inactive"
          ? "LOCALITY_DISABLED"
          : "LOCALITY_NOT_COVERED"
        : row?.delivers === false
          ? "OUTSIDE_DELIVERY_SCOPE"
          : null;
    return { allowed: reason === null, reason };
  },

  /**
   * Estado efetivo de compra do consumidor em um município.
   * O bloqueio de compra é global ou por região; a cobertura é sempre exigida.
   */
  async canPurchaseIn(userId: string, municipalityId: string | null) {
    const pool = requirePool();
    const result = await pool.query<{
      coverage: string | null;
      blocked: boolean;
      block_kind: string;
    }>(
      [
        "SELECT" ,
        municipalityId === null
          ? " NULL::text AS coverage,"
          : " public.fn_locality_coverage_by_id($2) AS coverage,",
        "       public.fn_is_purchase_blocked($1,$2) AS blocked,",
        "       public.fn_partial_block_kind($1,'consumer_purchasing') AS block_kind",
      ].join(" "),
      [userId, municipalityId],
    );
    const row = result.rows[0];
    const blocked = Boolean(row?.blocked) || row?.block_kind === "all";
    const coverage = row?.coverage ?? "unknown";
    const reason = blocked
      ? "PARTIAL_BLOCK"
      : coverage === "active"
        ? null
        : coverage === "inactive"
          ? "LOCALITY_DISABLED"
          : "LOCALITY_NOT_COVERED";
    return { allowed: reason === null, reason };
  },

  async getDeliveryScope(userId: string): Promise<ProducerDeliveryScope> {
    const client = await requirePool().connect();
    try {
      const producerId = await resolveProducerId(client, userId);
      await assertProducerApproved(client, producerId);
      const scope = await client.query<{ scope: DeliveryScopeMode; revision: number }>(
        "SELECT scope,revision FROM public.app_producer_delivery_scopes WHERE producer_id=$1",
        [producerId],
      );
      const municipalities = await client.query<{ municipality_id: string }>(
        "SELECT municipality_id FROM public.app_producer_delivery_municipalities WHERE producer_id=$1 ORDER BY municipality_id",
        [producerId],
      );
      return {
        mode: (scope.rows[0]?.scope ?? "property_municipality") as DeliveryScopeMode,
        revision: scope.rows[0]?.revision ?? 1,
        municipalityIds: scope.rows[0]?.scope === "custom"
          ? municipalities.rows.map((row) => row.municipality_id)
          : [],
      };
    } finally {
      client.release();
    }
  },

  async updateDeliveryScope(
    userId: string,
    role: string,
    input: {
      mode: DeliveryScopeMode;
      municipalityIds: string[];
      expectedRevision: number;
      commandId: string;
    },
    requestId: string,
    ipHash: string,
  ): Promise<ProducerDeliveryScope> {
    const client = await requirePool().connect();
    try {
      await client.query("BEGIN");
      const producerId = await resolveProducerId(client, userId, true);
      await assertProducerApproved(client, producerId);

      const replayed = await client.query(
        "SELECT 1 FROM public.app_audit_events WHERE command_id=$1 LIMIT 1",
        [input.commandId],
      );
      if (replayed.rows[0]) {
        await client.query("COMMIT");
        return await this.getDeliveryScope(userId);
      }

      const current = await client.query<{ scope: DeliveryScopeMode; revision: number }>(
        "SELECT scope,revision FROM public.app_producer_delivery_scopes WHERE producer_id=$1",
        [producerId],
      );
      const revision = current.rows[0]?.revision ?? 1;
      if (current.rows[0] && revision !== input.expectedRevision) {
        await client.query("ROLLBACK");
        throw new AccessScopeError("REVISION_CONFLICT", 409);
      }

      // Só municípios ativos podem ser escolhidos: a escolha é revalidada no
      // banco a cada leitura, então uma desativação posterior corta a entrega
      // sem apagar a intenção declarada.
      const selected = input.mode === "custom" ? [...new Set(input.municipalityIds)] : [];
      if (selected.length) {
        const valid = await client.query<{ id: string }>(
          "SELECT id FROM public.app_municipalities WHERE id=ANY($1::uuid[]) AND is_active",
          [selected],
        );
        if (valid.rows.length !== selected.length) {
          await client.query("ROLLBACK");
          throw new AccessScopeError("INVALID_MUNICIPALITY", 422);
        }
      }

      await client.query(
        [
          "INSERT INTO public.app_producer_delivery_scopes(producer_id,scope,updated_by)",
          "VALUES($1,$2,$3)",
          "ON CONFLICT (producer_id) DO UPDATE SET",
          "  scope=excluded.scope,",
          "  updated_by=excluded.updated_by,",
          "  revision=public.app_producer_delivery_scopes.revision+1",
        ].join(" "),
        [producerId, input.mode, userId],
      );
      await client.query(
        "DELETE FROM public.app_producer_delivery_municipalities WHERE producer_id=$1",
        [producerId],
      );
      if (selected.length)
        await client.query(
          "INSERT INTO public.app_producer_delivery_municipalities(producer_id,municipality_id) SELECT $1, unnest($2::uuid[])",
          [producerId, selected],
        );

      await writeAudit(client, {
        requestId,
        actorId: userId,
        actorRole: role,
        action: "locality.delivery_scope_updated",
        targetEntity: "app_producer_delivery_scopes",
        targetId: producerId,
        before: current.rows[0] ?? { scope: "property_municipality" },
        after: { scope: input.mode, municipalities: selected.length },
        ipHash,
        commandId: input.commandId,
      });

      await client.query("COMMIT");
      return {
        mode: input.mode,
        revision: current.rows[0] ? revision + 1 : 1,
        municipalityIds: selected,
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      if (error instanceof AccessScopeError) throw error;
      mapDbError(error);
    } finally {
      client.release();
    }
  },

  async listPartialBlocks(filter: {
    userId?: string;
    subject?: PartialBlockSubject;
    onlyActive?: boolean;
  }) {
    const client = await requirePool().connect();
    try {
      const result = await client.query<Record<string, any>>(
        [
          "SELECT b.*,pe.full_name AS user_full_name,pe.email_normalized AS user_email",
          "  FROM public.app_access_partial_blocks b",
          "  LEFT JOIN public.app_people pe ON pe.user_id=b.user_id",
          " WHERE ($1::uuid IS NULL OR b.user_id=$1)",
          "   AND ($2::text IS NULL OR b.subject=$2)",
          "   AND ($3::boolean IS NOT TRUE OR b.is_active)",
          " ORDER BY b.created_at DESC LIMIT 200",
        ].join(" "),
        [filter.userId ?? null, filter.subject ?? null, filter.onlyActive ?? false],
      );
      const children = await loadBlockChildren(
        client,
        result.rows.map((row) => row.id),
      );
      return result.rows.map((row) =>
        mapPartialBlock(
          row,
          children.municipalities.get(row.id) ?? [],
          children.properties.get(row.id) ?? [],
        ),
      );
    } finally {
      client.release();
    }
  },

  /**
   * Bloqueio parcial de localidade. Substitui, por assunto, o bloqueio ativo
   * anterior do mesmo titular — a trava é sempre a decisão administrativa mais
   * recente, nunca uma acumulação silenciosa.
   */
  async createPartialBlock(
    input: {
      userId: string;
      subject: PartialBlockSubject;
      scope: PartialBlockScope;
      reason: string;
      municipalityIds: string[];
      propertyIds: string[];
      commandId: string;
    },
    actor: { userId: string; role: string },
    requestId: string,
    ipHash: string,
  ) {
    const client = await requirePool().connect();
    try {
      await client.query("BEGIN");
      const replayed = await client.query(
        "SELECT 1 FROM public.app_audit_events WHERE command_id=$1 LIMIT 1",
        [input.commandId],
      );
      if (replayed.rows[0]) {
        await client.query("COMMIT");
        const existing = await this.listPartialBlocks({
          userId: input.userId,
          subject: input.subject,
          onlyActive: true,
        });
        if (existing[0])
          return { status: "created" as const, block: existing[0] };
        return { status: "revoked" as const };
      }

      const account = await client.query(
        "SELECT 1 FROM public.app_users WHERE id=$1 AND status<>'deleted'",
        [input.userId],
      );
      if (!account.rows[0]) {
        await client.query("ROLLBACK");
        throw new AccessScopeError("USER_NOT_FOUND", 404);
      }

      const selectedMunicipalities =
        input.scope === "custom" ? [...new Set(input.municipalityIds)] : [];
      const selectedProperties =
        input.subject === "producer_publishing" && input.scope === "custom"
          ? [...new Set(input.propertyIds)]
          : [];

      if (selectedMunicipalities.length) {
        const valid = await client.query<{ id: string }>(
          "SELECT id FROM public.app_municipalities WHERE id=ANY($1::uuid[])",
          [selectedMunicipalities],
        );
        if (valid.rows.length !== selectedMunicipalities.length) {
          await client.query("ROLLBACK");
          throw new AccessScopeError("INVALID_MUNICIPALITY", 422);
        }
      }
      if (selectedProperties.length) {
        const owner = await client.query<{ id: string }>(
          [
            "SELECT p.id FROM public.app_properties p",
            "  JOIN public.app_producer_profiles pp ON pp.id=p.producer_id",
            "  JOIN public.app_people pe ON pe.id=pp.person_id",
            " WHERE pe.user_id=$1 AND p.id=ANY($2::uuid[])",
          ].join(" "),
          [input.userId, selectedProperties],
        );
        if (owner.rows.length !== selectedProperties.length) {
          await client.query("ROLLBACK");
          throw new AccessScopeError("INVALID_PROPERTY", 422);
        }
      }

      // Substituição atômica por (user_id, subject): revoga o bloqueio anterior
      // e grava o novo, mantendo o índice único parcial sempre consistente.
      const previous = await client.query<Record<string, any>>(
        [
          "UPDATE public.app_access_partial_blocks",
          "   SET is_active=false,revoked_at=clock_timestamp(),revoked_by=$2,revoke_reason='substituido_por_novo_bloqueio'",
          " WHERE user_id=$1 AND subject=$3 AND is_active",
          " RETURNING *",
        ].join(" "),
        [input.userId, actor.userId, input.subject],
      );

      const inserted = await client.query<Record<string, any>>(
        [
          "INSERT INTO public.app_access_partial_blocks",
          "(user_id,subject,scope,reason,created_by,command_id)",
          "VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        ].join(" "),
        [
          input.userId,
          input.subject,
          input.scope,
          input.reason,
          actor.userId,
          input.commandId,
        ],
      );
      const row = inserted.rows[0];

      if (selectedMunicipalities.length)
        await client.query(
          "INSERT INTO public.app_access_partial_block_municipalities(block_id,municipality_id) SELECT $1, unnest($2::uuid[])",
          [row.id, selectedMunicipalities],
        );
      if (selectedProperties.length)
        await client.query(
          "INSERT INTO public.app_access_partial_block_properties(block_id,property_id) SELECT $1, unnest($2::uuid[])",
          [row.id, selectedProperties],
        );

      await writeAudit(client, {
        requestId,
        actorId: actor.userId,
        actorRole: actor.role,
        action: "locality.partial_block_created",
        targetEntity: "app_access_partial_blocks",
        targetId: row.id,
        before: previous.rows[0]
          ? { subject: previous.rows[0].subject, scope: previous.rows[0].scope }
          : null,
        after: {
          subject: input.subject,
          scope: input.scope,
          municipalities: selectedMunicipalities.length,
          properties: selectedProperties.length,
        },
        ipHash,
        commandId: input.commandId,
      });

      await client.query("COMMIT");
      return {
        status: "created" as const,
        block: mapPartialBlock(row, selectedMunicipalities, selectedProperties),
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      if (error instanceof AccessScopeError) throw error;
      mapDbError(error);
    } finally {
      client.release();
    }
  },

  async revokePartialBlock(
    blockId: string,
    reason: string | null,
    actor: { userId: string; role: string },
    requestId: string,
    ipHash: string,
    commandId: string,
  ) {
    const client = await requirePool().connect();
    try {
      await client.query("BEGIN");
      const replayed = await client.query(
        "SELECT 1 FROM public.app_audit_events WHERE command_id=$1 LIMIT 1",
        [commandId],
      );
      if (replayed.rows[0]) {
        await client.query("COMMIT");
        return { status: "revoked" as const };
      }

      const updated = await client.query<Record<string, any>>(
        [
          "UPDATE public.app_access_partial_blocks",
          "   SET is_active=false,revoked_at=clock_timestamp(),revoked_by=$2,revoke_reason=$3",
          " WHERE id=$1 AND is_active RETURNING *",
        ].join(" "),
        [blockId, actor.userId, reason ?? "revogado_pela_administracao"],
      );
      if (!updated.rows[0]) {
        await client.query("ROLLBACK");
        return { status: "not_found" as const };
      }

      await writeAudit(client, {
        requestId,
        actorId: actor.userId,
        actorRole: actor.role,
        action: "locality.partial_block_revoked",
        targetEntity: "app_access_partial_blocks",
        targetId: blockId,
        before: { is_active: true, scope: updated.rows[0].scope },
        after: { is_active: false, reason },
        ipHash,
        commandId,
      });

      await client.query("COMMIT");
      return { status: "revoked" as const };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      if (error instanceof AccessScopeError) throw error;
      mapDbError(error);
    } finally {
      client.release();
    }
  },
};

export function accessScopeFailure(error: unknown, requestId: string) {
  if (error instanceof AccessScopeError)
    return { status: error.status, error: error.code, message: error.message };
  reportFailure("access_scope_operation_failed", requestId);
  return { status: 503, error: "UNAVAILABLE", message: "UNAVAILABLE" };
}
