import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import migrationManifest from "../../supabase/manifest.json" with { type: "json" };
import {
  AdminAppDistributionResponseSchema,
  AppDistributionResponseSchema,
  classifyAppDownloadUrl,
  type AdminAppDistributionResponse,
  type AppDistributionResponse,
  type AppDistributionUpdateResult,
  type AppPlatform,
  type UpdateAppDistributionRequest,
  UpdateAppDistributionRequestSchema,
} from "../../shared/contracts/appDistribution.ts";
import { FOUNDATION_SCHEMA_VERSION } from "../../shared/contracts/foundation.ts";
import { runtime } from "../config/runtime.ts";
import { dbPool } from "../db/pool.ts";
import type { AdminActorContext } from "../middleware/adminSession.ts";
import {
  commerceAdmin,
  commerceTransaction,
  type CommerceAudit,
} from "./CommerceSupport.ts";
import { assertRecentAuth } from "./reauthService.ts";
import { validateVerifiedPackage } from "./MobileReleaseService.ts";

type NativeInput = UpdateAppDistributionRequest["payload"]["android"];
type DistributionRow = {
  id: string;
  android: NativeInput;
  ios: NativeInput;
  release_notes: string;
  revision: number;
  updated_at: Date | string;
  updated_by: string | null;
  android_release?: NativeInput;
  ios_release?: NativeInput;
  android_managed?: boolean;
  ios_managed?: boolean;
  release: {
    release_tag: string;
    commit_sha: string;
    schema_version: number;
    migration_history_hash: string;
    deployed_at: string;
  } | null;
};

export class AppDistributionError extends Error {
  constructor(
    public code: string,
    public status: number,
    public currentRevision?: number,
  ) {
    super(code);
    this.name = "AppDistributionError";
  }
}

const distributionSql = `SELECT d.id,d.android,d.ios,d.release_notes,d.revision,d.updated_at,d.updated_by,
  (SELECT json_build_object('version',m.version,'url',m.url) FROM public.app_mobile_releases m
    WHERE m.platform='android' AND m.status='published') AS android_release,
  (SELECT json_build_object('version',m.version,'url',m.url) FROM public.app_mobile_releases m
    WHERE m.platform='ios' AND m.status='published') AS ios_release,
  EXISTS(SELECT 1 FROM public.app_mobile_releases m WHERE m.platform='android') AS android_managed,
  EXISTS(SELECT 1 FROM public.app_mobile_releases m WHERE m.platform='ios') AS ios_managed,
  (SELECT json_build_object('release_tag',r.release_tag,'commit_sha',r.commit_sha,
    'schema_version',r.schema_version,'migration_history_hash',r.migration_history_hash,'deployed_at',r.deployed_at)
    FROM public.app_releases r WHERE r.environment=$1 AND r.is_current) AS release
  FROM public.app_mobile_distribution d WHERE d.singleton_guard=true`;

function nativeAvailability(
  platform: AppPlatform,
  input: NativeInput,
  updatedAt: string,
  verifiedPackage = false,
  managed = false,
) {
  const candidate = input && classifyAppDownloadUrl(platform, input.url);
  const channel = candidate === "apk" && !verifiedPackage ? null : candidate;
  return {
    available: Boolean(channel),
    version: channel && input ? input.version : null,
    url: channel && input ? input.url : null,
    downloadUrl: channel ? "/downloads/" + platform : null,
    channel: channel || null,
    updatedAt: channel ? updatedAt : null,
    managedBy: managed ? "pipeline" : channel ? "manual" : "none",
  };
}

/** Exported for contract verification; operator identity is excluded from public DTO. */
export function presentAppDistribution(
  row: DistributionRow,
): AdminAppDistributionResponse {
  const updatedAt = new Date(row.updated_at).toISOString(),
    release = row.release;
  const available = Boolean(
    release &&
    release.schema_version === FOUNDATION_SCHEMA_VERSION &&
    release.migration_history_hash === migrationManifest.migrationHistoryHash &&
    ((runtime.appEnv === "development" && !runtime.commitSha) ||
      release.commit_sha === runtime.commitSha),
  );
  return AdminAppDistributionResponseSchema.parse({
    revision: row.revision,
    updatedAt,
    updatedBy: row.updated_by,
    releaseNotes: row.release_notes,
    android: nativeAvailability("android", row.android_release ?? (row.android_managed ? null : row.android), updatedAt, Boolean(row.android_release), Boolean(row.android_managed)),
    ios: nativeAvailability("ios", row.ios_release ?? (row.ios_managed ? null : row.ios), updatedAt, false, Boolean(row.ios_managed)),
    web: {
      version: release?.release_tag ?? "",
      commitSha: release?.commit_sha ?? "",
      schemaVersion: release?.schema_version ?? FOUNDATION_SCHEMA_VERSION,
      available,
      updatedAt: release ? new Date(release.deployed_at).toISOString() : null,
      updateMode: "hosted_web",
      requiresStoreUpdateForNativeChanges: true,
    },
  });
}

async function read(client: Pick<PoolClient, "query">, lock = false) {
  const result = await client.query<DistributionRow>(
    distributionSql + (lock ? " FOR UPDATE OF d" : ""),
    [runtime.appEnv],
  );
  if (!result.rows[0])
    throw new AppDistributionError("DISTRIBUTION_NOT_INITIALIZED", 503);
  return result.rows[0];
}

export class AppDistributionService {
  static async getPublic(): Promise<AppDistributionResponse> {
    if (!dbPool) throw new AppDistributionError("DEPENDENCY_UNAVAILABLE", 503);
    const admin = presentAppDistribution(await read(dbPool));
    const { updatedBy: _updatedBy, ...publicManifest } = admin;
    return AppDistributionResponseSchema.parse(publicManifest);
  }

  static async getAdmin(
    actor: AdminActorContext,
  ): Promise<AdminAppDistributionResponse> {
    return commerceTransaction(async (client) => {
      await commerceAdmin(client, actor, "platform_configuration");
      return presentAppDistribution(await read(client));
    });
  }

  static async getDownload(platform: AppPlatform): Promise<string | null> {
    const manifest = await this.getPublic();
    return manifest[platform].available ? manifest[platform].url : null;
  }

  static async update(
    raw: UpdateAppDistributionRequest,
    actor: AdminActorContext,
    context: CommerceAudit,
  ): Promise<AppDistributionUpdateResult> {
    const input = UpdateAppDistributionRequestSchema.parse(raw);
    await assertRecentAuth(actor);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    return commerceTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(20,hashtext($1))", [
        input.commandId,
      ]);
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('hvm-app-distribution'))",
      );
      await commerceAdmin(client, actor, "platform_configuration");
      const prior = (
        await client.query<{
          user_id: string;
          operation: string;
          payload_hash: string;
          response_body: AppDistributionUpdateResult;
        }>(
          "SELECT user_id,operation,payload_hash,response_body FROM public.app_commerce_receipts WHERE command_id=$1",
          [input.commandId],
        )
      ).rows[0];
      if (prior) {
        if (
          prior.user_id !== actor.userId ||
          prior.operation !== "app-distribution.update" ||
          prior.payload_hash !== fingerprint
        )
          throw new AppDistributionError("COMMAND_ID_PAYLOAD_MISMATCH", 409);
        return prior.response_body.status === "success"
          ? { ...prior.response_body, status: "idempotent_replay" }
          : prior.response_body;
      }
      const current = await read(client, true);
      if (current.revision !== input.expectedRevision)
        throw new AppDistributionError(
          "DISTRIBUTION_REVISION_CONFLICT",
          409,
          current.revision,
        );
      await validateVerifiedPackage(client, input.payload.android);
      const sameNative = (left: NativeInput, right: NativeInput) =>
        left === right ||
        Boolean(
          left &&
          right &&
          left.url === right.url &&
          left.version === right.version,
        );
      const changed =
        !sameNative(current.android, input.payload.android) ||
        !sameNative(current.ios, input.payload.ios) ||
        current.release_notes !== input.payload.releaseNotes;
      let result: AppDistributionUpdateResult;
      if (!changed)
        result = { status: "no_change", revision: current.revision };
      else {
        const revision = (
          await client.query<{ revision: number }>(
            `UPDATE public.app_mobile_distribution
          SET android=$1,ios=$2,release_notes=$3,revision=revision+1,updated_at=clock_timestamp(),updated_by=$4
          WHERE singleton_guard=true RETURNING revision`,
            [
              input.payload.android,
              input.payload.ios,
              input.payload.releaseNotes,
              actor.userId,
            ],
          )
        ).rows[0].revision;
        const audit = await client.query<{ id: string }>(
          `INSERT INTO public.app_audit_events
          (request_id,actor_id,actor_role,action,target_entity,target_id,payload_before,payload_after,client_ip_hash,command_id)
          VALUES($1,$2,$3,'app.distribution.updated','app_mobile_distribution',$4,$5,$6,$7,$8) RETURNING id`,
          [
            context.requestId,
            actor.userId,
            actor.role,
            current.id,
            {
              android: current.android,
              ios: current.ios,
              releaseNotes: current.release_notes,
              revision: current.revision,
            },
            { ...input.payload, revision },
            context.ipHash,
            input.commandId,
          ],
        );
        result = {
          status: "success",
          revision,
          auditEventId: audit.rows[0].id,
        };
      }
      await client.query(
        `INSERT INTO public.app_commerce_receipts(command_id,user_id,operation,payload_hash,response_body)
        VALUES($1,$2,'app-distribution.update',$3,$4)`,
        [input.commandId, actor.userId, fingerprint, result],
      );
      return result;
    });
  }
}
