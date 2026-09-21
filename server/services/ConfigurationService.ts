import type { PoolClient } from "pg";
import { dbPool } from "../db/pool.ts";
import { reportFailure, classifyDbError } from "../config/reportFailure.ts";
import type {
  ConfigUpdateResult,
  GlobalConfigAdminResponse,
  UpdateGlobalConfigInput,
} from "../../shared/contracts/adminConfig.ts";
import { redactPII } from "../security/redactPII.ts";
import { sha256Hex } from "../security/hash.ts";
import { assertRecentAuth } from "./reauthService.ts";

export interface ActorContext {
  userId: string;
  role: "platform_super_admin";
  sessionIssuedAt: string;
}

type CurrentConfigRow = {
  id: string;
  platform_name: string;
  slogan: string;
  default_municipality: string;
  default_state: string;
  currency: string;
  timezone: string;
  support_email: string;
  support_phone: string | null;
  revision: number;
};

export class ConfigurationService {
  static async updateConfig(
    input: UpdateGlobalConfigInput,
    actor: ActorContext,
    requestId: string,
    clientIpHash: string,
  ): Promise<ConfigUpdateResult> {
    if (!dbPool)
      throw Object.assign(new Error("db_not_configured"), {
        code: "DB_NOT_CONFIGURED",
      });

    await assertRecentAuth(actor);
    const payloadHash = sha256Hex(JSON.stringify(input.payload));

    for (let attempt = 0; attempt < 2; attempt++) {
      const client = await dbPool.connect();
      try {
        return await this.updateInTransaction(
          client,
          input,
          actor,
          requestId,
          clientIpHash,
          payloadHash,
        );
      } catch (error) {
        const code = (error as { code?: string }).code;
        if ((code === "40001" || code === "40P01") && attempt === 0)
          continue;
        reportFailure({
          category: classifyDbError(error),
          requestId,
          detail: code ?? (error as { name?: string }).name ?? "unknown",
        });
        throw error;
      } finally {
        client.release();
      }
    }
    throw new Error("config_update_retry_exhausted");
  }

  private static async updateInTransaction(
    client: PoolClient,
    input: UpdateGlobalConfigInput,
    actor: ActorContext,
    requestId: string,
    clientIpHash: string,
    payloadHash: string,
  ): Promise<ConfigUpdateResult> {
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "config:cmd:" + input.commandId,
      ]);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "config:singleton",
      ]);

      const replay = await this.findExistingCommand(client, input.commandId);
      if (replay) {
        await client.query("COMMIT");
        if (replay.payloadHash !== payloadHash)
          return {
            status: "idempotent_mismatch",
            message:
              "commandId reutilizado com payload divergente — rejeitado por segurança.",
          };
        return {
          status: "idempotent_replay",
          revision: replay.resultRevision,
          auditEventId: replay.auditEventId,
        };
      }

      const currentRes = await client.query<CurrentConfigRow>(
        [
          "SELECT id,platform_name,slogan,default_municipality,default_state,",
          "currency,timezone,support_email,support_phone,revision",
          "FROM public.app_global_config",
          "WHERE singleton_guard=true FOR UPDATE",
        ].join(" "),
      );
      const current = currentRes.rows[0];
      if (!current) {
        await client.query("ROLLBACK");
        throw new Error("config_singleton_missing");
      }

      if (current.revision !== input.expectedRevision) {
        await client.query("ROLLBACK");
        return { status: "conflict", currentRevision: current.revision };
      }

      const changes = this.diffConfig(current, input.payload);
      if (changes.fields.length === 0) {
        await client.query("COMMIT");
        return { status: "no_change", revision: current.revision };
      }

      const values: unknown[] = [];
      const setClauses: string[] = [];
      let index = 1;
      for (const field of changes.fields) {
        setClauses.push(this.fieldToColumn(field) + "=$" + index);
        values.push(changes.after[field]);
        index++;
      }
      setClauses.push("updated_by=$" + index);
      values.push(actor.userId);

      await client.query(
        "UPDATE public.app_global_config SET " +
          setClauses.join(",") +
          " WHERE singleton_guard=true",
        values,
      );

      const revisionRes = await client.query<{ revision: number }>(
        "SELECT revision FROM public.app_global_config WHERE singleton_guard=true",
      );
      const newRevision = revisionRes.rows[0].revision;

      const auditBefore = {
        ...redactPII(changes.before),
        __command_hash__: payloadHash,
      };
      const auditAfter = {
        ...redactPII(changes.after),
        __revision_after__: newRevision,
      };
      const auditRes = await client.query<{ id: string }>(
        [
          "INSERT INTO public.app_audit_events",
          "(request_id,actor_id,actor_role,action,target_entity,target_id,",
          "payload_before,payload_after,client_ip_hash,command_id)",
          "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
        ].join(" "),
        [
          requestId,
          actor.userId,
          actor.role,
          "config.updated",
          "app_global_config",
          current.id,
          JSON.stringify(auditBefore),
          JSON.stringify(auditAfter),
          clientIpHash,
          input.commandId,
        ],
      );

      await client.query("COMMIT");
      return {
        status: "success",
        revision: newRevision,
        auditEventId: auditRes.rows[0].id,
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Sem transação ativa.
      }
      throw error;
    }
  }

  private static async findExistingCommand(
    client: PoolClient,
    commandId: string,
  ): Promise<{
    payloadHash: string;
    resultRevision: number;
    auditEventId: string;
  } | null> {
    const res = await client.query<{
      id: string;
      payload_before: Record<string, unknown> | null;
      payload_after: Record<string, unknown> | null;
    }>(
      "SELECT id,payload_before,payload_after FROM public.app_audit_events WHERE command_id=$1 LIMIT 1",
      [commandId],
    );
    const row = res.rows[0];
    if (!row) return null;
    const before = row.payload_before ?? {};
    const after = row.payload_after ?? {};
    return {
      payloadHash: String(before.__command_hash__ ?? ""),
      resultRevision: Number(after.__revision_after__ ?? 0),
      auditEventId: row.id,
    };
  }

  private static diffConfig(
    current: CurrentConfigRow,
    payload: UpdateGlobalConfigInput["payload"],
  ) {
    const fields: string[] = [];
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const mapping: Record<string, keyof CurrentConfigRow> = {
      slogan: "slogan",
      defaultMunicipality: "default_municipality",
      defaultState: "default_state",
      supportEmail: "support_email",
      supportPhone: "support_phone",
    };

    for (const [field, column] of Object.entries(mapping)) {
      if (!(field in payload)) continue;
      const newValue = (payload as Record<string, unknown>)[field];
      if (newValue === undefined || current[column] === newValue) continue;
      fields.push(field);
      before[field] = current[column];
      after[field] = newValue;
    }
    return { fields, before, after };
  }

  private static fieldToColumn(field: string): string {
    const map: Record<string, string> = {
      slogan: "slogan",
      defaultMunicipality: "default_municipality",
      defaultState: "default_state",
      supportEmail: "support_email",
      supportPhone: "support_phone",
    };
    const column = map[field];
    if (!column) throw new Error("unknown_field:" + field);
    return column;
  }

  static async getAdminConfig(): Promise<GlobalConfigAdminResponse | null> {
    if (!dbPool) return null;
    const res = await dbPool.query<{
      platform_name: string;
      slogan: string;
      default_municipality: string;
      default_state: string;
      currency: string;
      timezone: string;
      support_email: string;
      support_phone: string | null;
      revision: number;
      updated_at: Date;
      updated_by: string | null;
    }>(
      [
        "SELECT platform_name,slogan,default_municipality,default_state,currency,",
        "timezone,support_email,support_phone,revision,updated_at,updated_by",
        "FROM public.app_global_config WHERE singleton_guard=true LIMIT 1",
      ].join(" "),
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      platformName: row.platform_name,
      slogan: row.slogan,
      defaultMunicipality: row.default_municipality,
      defaultState: row.default_state,
      currency: row.currency,
      timezone: row.timezone,
      supportEmail: row.support_email,
      supportPhone: row.support_phone,
      revision: row.revision,
      updatedAt: row.updated_at.toISOString(),
      updatedBy: row.updated_by,
    };
  }
}
