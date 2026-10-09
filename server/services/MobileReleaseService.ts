import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import {
  AdminMobileReleasesSchema,
  MOBILE_CI_AUDIENCE,
  MobileReleaseCommandSchema,
  PrepareMobileUploadRequestSchema,
  PublicMobileReleasesSchema,
  PublishMobileCiRequestSchema,
  type AdminMobileReleases,
  type MobileReleaseCommand,
  type MobileReleaseCommandResult,
  type PrepareMobileUploadRequest,
  type PublicMobileRelease,
  type PublicMobileReleases,
  type PublishMobileCiRequest,
} from "../../shared/contracts/mobileReleases.ts";
import {
  APP_BINARY_STORAGE_ORIGIN,
  type AppPlatform,
} from "../../shared/contracts/appDistribution.ts";
import { FOUNDATION_SCHEMA_VERSION } from "../../shared/contracts/foundation.ts";
import { runtime } from "../config/runtime.ts";
import { dbPool } from "../db/pool.ts";
import { supabaseAdmin } from "../supabase/client.ts";
import type { AdminActorContext } from "../middleware/adminSession.ts";
import type { MobileCiIdentity } from "../security/mobileCiIdentity.ts";
import {
  commerceAdmin,
  commerceAudit,
  commerceTransaction,
  type CommerceAudit,
} from "./CommerceSupport.ts";
import { assertRecentAuth } from "./reauthService.ts";

export class MobileReleaseError extends Error {
  constructor(
    public code: string,
    public status = 409,
    public currentRevision?: number,
  ) {
    super(code);
  }
}
type Policy = {
  revision: number;
  android_minimum_build: number;
  ios_minimum_build: number;
  android_auto_publish: boolean;
  ios_auto_publish: boolean;
  android_signing_identity: string | null;
  ios_signing_identity: string | null;
  updated_at: Date | string;
};
type ReleaseRow = {
  id: string;
  platform: AppPlatform;
  version: string;
  build_number: number;
  min_supported_build: number;
  runtime_fingerprint: string;
  source_commit: string;
  schema_version: number;
  sha256: string;
  size_bytes: number;
  channel: PublishMobileCiRequest["channel"];
  url: string;
  release_notes: string;
  signing_identity: string;
  status: "verified" | "published" | "withdrawn";
  verified_at: Date | string;
  published_at: Date | string | null;
  ci_run_id: string;
  ci_run_attempt: number;
  payload_hash: string;
};
type Query = Pick<PoolClient, "query">;
const iso = (value: Date | string) => new Date(value).toISOString();
const prefix =
  APP_BINARY_STORAGE_ORIGIN + "/storage/v1/object/public/app-downloads/";
export function mobilePackageStoragePath(input: PrepareMobileUploadRequest) {
  return `android/${input.buildNumber}/${input.sha256}.apk`;
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function publicRelease(row: ReleaseRow, floor: number): PublicMobileRelease {
  return {
    id: row.id,
    platform: row.platform,
    version: row.version,
    buildNumber: row.build_number,
    minSupportedBuild: Math.max(row.min_supported_build, floor),
    runtimeFingerprint: row.runtime_fingerprint,
    sourceCommit: row.source_commit,
    schemaVersion: row.schema_version,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    channel: row.channel,
    url: row.url,
    downloadUrl: "/downloads/" + row.platform,
    publishedAt: row.published_at ? iso(row.published_at) : null,
    releaseNotes: row.release_notes,
  };
}
async function policy(client: Query, lock = false) {
  const row = (
    await client.query<Policy>(
      "SELECT * FROM public.app_mobile_release_policy WHERE singleton_guard=true" +
        (lock ? " FOR UPDATE" : " FOR SHARE"),
    )
  ).rows[0];
  if (!row) throw new MobileReleaseError("MOBILE_RELEASES_UNAVAILABLE", 503);
  return row;
}
async function current(
  client: Query,
  state: Policy,
): Promise<PublicMobileReleases> {
  const releases = (
    await client.query<ReleaseRow>(
      "SELECT * FROM public.app_mobile_releases WHERE status='published' ORDER BY platform",
    )
  ).rows;
  const presentation = PublicMobileReleasesSchema.safeParse({
    revision: state.revision,
    updatedAt: iso(state.updated_at),
    minimumSupportedBuild: {
      android: state.android_minimum_build,
      ios: state.ios_minimum_build,
    },
    android: releases.find((row) => row.platform === "android")
      ? publicRelease(
          releases.find((row) => row.platform === "android")!,
          state.android_minimum_build,
        )
      : null,
    ios: releases.find((row) => row.platform === "ios")
      ? publicRelease(
          releases.find((row) => row.platform === "ios")!,
          state.ios_minimum_build,
        )
      : null,
  });
  if (!presentation.success)
    throw new MobileReleaseError("MOBILE_RELEASES_UNAVAILABLE", 503);
  return presentation.data;
}
async function lockState(client: PoolClient) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('hvm-mobile-releases'))",
  );
  return policy(client, true);
}
async function advance(client: PoolClient, actorId: string | null) {
  return (
    await client.query<{ revision: number }>(
      "UPDATE public.app_mobile_release_policy SET revision=revision+1,updated_at=clock_timestamp(),updated_by=$1 WHERE singleton_guard RETURNING revision",
      [actorId],
    )
  ).rows[0].revision;
}
async function event(
  client: PoolClient,
  releaseId: string | null,
  action: string,
  revision: number,
  actorId: string | null,
  runId: string | null,
) {
  await client.query(
    "INSERT INTO public.app_mobile_release_events(release_id,action,revision,actor_id,ci_run_id) VALUES($1,$2,$3,$4,$5)",
    [releaseId, action, revision, actorId, runId],
  );
}
async function ciReplay(
  client: PoolClient,
  release: ReleaseRow,
  identity: MobileCiIdentity,
) {
  if (release.platform === "android")
    await client.query(
      "UPDATE public.app_mobile_uploads SET consumed_at=clock_timestamp() WHERE ci_run_id=$1 AND ci_run_attempt=$2 AND source_commit=$3 AND build_number=$4 AND sha256=$5 AND size_bytes=$6 AND consumed_at IS NULL",
      [
        identity.runId,
        identity.runAttempt,
        release.source_commit,
        release.build_number,
        release.sha256,
        release.size_bytes,
      ],
    );
  return {
    status: "idempotent_replay" as const,
    releaseId: release.id,
    revision: (await policy(client)).revision,
  };
}
async function activate(
  client: PoolClient,
  release: ReleaseRow,
  state: Policy,
  automatic = false,
) {
  const platform = release.platform;
  if (release.build_number < state[`${platform}_minimum_build`])
    throw new MobileReleaseError("MOBILE_BUILD_BELOW_MINIMUM");
  const approved = state[`${platform}_signing_identity`];
  if (approved && approved !== release.signing_identity)
    throw new MobileReleaseError("MOBILE_SIGNING_IDENTITY_MISMATCH");
  if (automatic) {
    const highWater = (
      await client.query<{ build_number: number | null }>(
        "SELECT max(build_number)::integer AS build_number FROM public.app_mobile_releases WHERE platform=$1 AND published_at IS NOT NULL",
        [platform],
      )
    ).rows[0].build_number;
    if (highWater !== null && highWater >= release.build_number)
      throw new MobileReleaseError("MOBILE_BUILD_NOT_NEWER");
  }
  await client.query(
    "UPDATE public.app_mobile_releases SET status='withdrawn',withdrawn_at=clock_timestamp() WHERE platform=$1 AND status='published' AND id<>$2",
    [platform, release.id],
  );
  await client.query(
    "UPDATE public.app_mobile_releases SET status='published',published_at=clock_timestamp(),withdrawn_at=null WHERE id=$1",
    [release.id],
  );
  // Identifiers originate from the validated platform enum, never from input text.
  await client.query(
    `UPDATE public.app_mobile_release_policy SET ${platform}_minimum_build=GREATEST(${platform}_minimum_build,$1),${platform}_signing_identity=COALESCE(${platform}_signing_identity,$2) WHERE singleton_guard`,
    [release.min_supported_build, release.signing_identity],
  );
}

/** A manual APK pointer may only refer to this immutable, CI-verified ledger. */
export async function validateVerifiedPackage(
  client: Query,
  input: { version: string; url: string } | null,
) {
  if (!input || !input.url.endsWith(".apk")) return;
  const result = await client.query(
    "SELECT 1 FROM public.app_mobile_releases WHERE platform='android' AND version=$1 AND url=$2 AND status='published'",
    [input.version, input.url],
  );
  if (!result.rowCount)
    throw new MobileReleaseError("APP_PACKAGE_NOT_VERIFIED", 422);
}

export class MobileReleaseService {
  static async getPublic(): Promise<PublicMobileReleases> {
    return commerceTransaction(async (client) =>
      current(client, await policy(client)),
    );
  }
  static async getPublished(
    platform: AppPlatform,
  ): Promise<PublicMobileRelease | null> {
    return (await this.getPublic())[platform];
  }
  static async getAdmin(
    actor: AdminActorContext,
  ): Promise<AdminMobileReleases> {
    return commerceTransaction(async (client) => {
      await commerceAdmin(client, actor, "platform_configuration");
      const state = await policy(client);
      const rows = (
        await client.query<ReleaseRow>(
          "SELECT * FROM public.app_mobile_releases ORDER BY verified_at DESC,id DESC LIMIT 100",
        )
      ).rows;
      const pending = (
        await client.query<{ count: number }>(
          "SELECT count(*)::integer AS count FROM public.app_mobile_uploads WHERE consumed_at IS NULL AND expires_at>clock_timestamp()",
        )
      ).rows[0].count;
      const presentation = AdminMobileReleasesSchema.safeParse({
        revision: state.revision,
        updatedAt: iso(state.updated_at),
        minimumSupportedBuild: {
          android: state.android_minimum_build,
          ios: state.ios_minimum_build,
        },
        autoPublish: {
          android: state.android_auto_publish,
          ios: state.ios_auto_publish,
        },
        releases: rows.map((row) => ({
          ...publicRelease(row, row.min_supported_build),
          status: row.status,
          verifiedAt: iso(row.verified_at),
          signingIdentity: row.signing_identity,
          ciRunId: row.ci_run_id,
          ciRunAttempt: row.ci_run_attempt,
        })),
        sync: {
          state: rows.length ? "ready" : "awaiting_first_release",
          lastVerifiedAt: rows[0] ? iso(rows[0].verified_at) : null,
          pendingUploads: pending,
          webCommit: runtime.commitSha,
          webSchema: FOUNDATION_SCHEMA_VERSION,
          storageConfigured: Boolean(
            supabaseAdmin &&
            runtime.supabaseUrl.replace(/\/$/, "") ===
              APP_BINARY_STORAGE_ORIGIN,
          ),
          oidcAudience: MOBILE_CI_AUDIENCE,
        },
      });
      if (!presentation.success)
        throw new MobileReleaseError("MOBILE_RELEASES_UNAVAILABLE", 503);
      return presentation.data;
    });
  }
  static async command(
    raw: MobileReleaseCommand,
    actor: AdminActorContext,
    audit: CommerceAudit,
  ): Promise<MobileReleaseCommandResult> {
    const input = MobileReleaseCommandSchema.parse(raw);
    await assertRecentAuth(actor);
    return commerceTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(20,hashtext($1))", [
        input.commandId,
      ]);
      const state = await lockState(client);
      await commerceAdmin(client, actor, "platform_configuration");
      const previous = (
        await client.query<{
          user_id: string;
          operation: string;
          payload_hash: string;
          response_body: MobileReleaseCommandResult;
        }>(
          "SELECT user_id,operation,payload_hash,response_body FROM public.app_commerce_receipts WHERE command_id=$1",
          [input.commandId],
        )
      ).rows[0];
      if (previous) {
        if (
          previous.user_id !== actor.userId ||
          previous.operation !== "mobile-releases.command" ||
          previous.payload_hash !== hash(input)
        )
          throw new MobileReleaseError("COMMAND_ID_PAYLOAD_MISMATCH");
        return previous.response_body.status === "success"
          ? { ...previous.response_body, status: "idempotent_replay" }
          : previous.response_body;
      }
      if (state.revision !== input.expectedRevision)
        throw new MobileReleaseError(
          "MOBILE_RELEASE_REVISION_CONFLICT",
          409,
          state.revision,
        );
      let changed = false,
        entityId = input.releaseId ?? null;
      if (input.action === "configure") {
        const next = input.autoPublish!;
        if (next.ios)
          throw new MobileReleaseError(
            "MOBILE_IOS_PUBLICATION_REQUIRES_APPROVAL",
            422,
          );
        changed =
          next.android !== state.android_auto_publish ||
          next.ios !== state.ios_auto_publish;
        if (changed)
          await client.query(
            "UPDATE public.app_mobile_release_policy SET android_auto_publish=$1,ios_auto_publish=$2 WHERE singleton_guard",
            [next.android, next.ios],
          );
      } else {
        const release = (
          await client.query<ReleaseRow>(
            "SELECT * FROM public.app_mobile_releases WHERE id=$1 FOR UPDATE",
            [input.releaseId],
          )
        ).rows[0];
        if (!release)
          throw new MobileReleaseError("MOBILE_RELEASE_NOT_FOUND", 404);
        if (input.action === "withdraw") {
          changed = release.status !== "withdrawn";
          if (changed)
            await client.query(
              "UPDATE public.app_mobile_releases SET status='withdrawn',withdrawn_at=clock_timestamp() WHERE id=$1",
              [release.id],
            );
        } else {
          if (input.action === "publish" && release.status === "withdrawn")
            throw new MobileReleaseError("MOBILE_RELEASE_RESTORE_REQUIRED");
          changed = release.status !== "published";
          if (changed) await activate(client, release, state);
        }
      }
      const revision = changed
        ? await advance(client, actor.userId)
        : state.revision;
      const result: MobileReleaseCommandResult = {
        status: changed ? "success" : "no_change",
        revision,
      };
      if (changed) {
        await event(
          client,
          entityId,
          input.action === "configure"
            ? "configured"
            : input.action === "publish"
              ? "published"
              : input.action === "restore"
                ? "restored"
                : "withdrawn",
          revision,
          actor.userId,
          null,
        );
        // Audit target_id is UUID; policy commands target the command UUID.
        await commerceAudit(
          client,
          actor.userId,
          actor.role,
          "app.mobile.release." + input.action,
          "app_mobile_releases",
          entityId ?? input.commandId,
          {
            action: input.action,
            revision,
            ...(input.autoPublish ? { autoPublish: input.autoPublish } : {}),
          },
          audit,
          input.commandId,
        );
      }
      await client.query(
        "INSERT INTO public.app_commerce_receipts(command_id,user_id,operation,payload_hash,response_body) VALUES($1,$2,'mobile-releases.command',$3,$4)",
        [input.commandId, actor.userId, hash(input), result],
      );
      return result;
    });
  }
  static async prepareUpload(
    raw: PrepareMobileUploadRequest,
    identity: MobileCiIdentity,
  ) {
    const input = PrepareMobileUploadRequestSchema.parse(raw);
    if (
      !supabaseAdmin ||
      runtime.supabaseUrl.replace(/\/$/, "") !== APP_BINARY_STORAGE_ORIGIN
    )
      throw new MobileReleaseError("MOBILE_STORAGE_NOT_CONFIGURED", 503);
    const path = mobilePackageStoragePath(input);
    const bucket = await supabaseAdmin.storage.getBucket("app-downloads");
    if (
      bucket.error &&
      bucket.error.message.toLowerCase().includes("not found")
    ) {
      const created = await supabaseAdmin.storage.createBucket(
        "app-downloads",
        {
          public: true,
          fileSizeLimit: 150 * 1024 * 1024,
          allowedMimeTypes: [
            "application/vnd.android.package-archive",
            "application/octet-stream",
          ],
        },
      );
      if (created.error)
        throw new MobileReleaseError("MOBILE_STORAGE_UNAVAILABLE", 503);
    } else if (bucket.error || !bucket.data?.public)
      throw new MobileReleaseError("MOBILE_STORAGE_UNAVAILABLE", 503);
    const upload = await supabaseAdmin.storage
      .from("app-downloads")
      .createSignedUploadUrl(path, { upsert: false });
    if (upload.error || !upload.data)
      throw new MobileReleaseError("MOBILE_STORAGE_UNAVAILABLE", 503);
    const expiresAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    const ledgerExpiresAt = await commerceTransaction(async (client) => {
      const previous = (
        await client.query<{
          storage_path: string;
          source_commit: string;
          size_bytes: number;
          expires_at: Date;
          consumed_at: Date | null;
        }>(
          "SELECT storage_path,source_commit,size_bytes,expires_at,consumed_at FROM public.app_mobile_uploads WHERE ci_run_id=$1 AND ci_run_attempt=$2 AND build_number=$3",
          [identity.runId, identity.runAttempt, input.buildNumber],
        )
      ).rows[0];
      if (
        previous &&
        (previous.storage_path !== path ||
          previous.source_commit !== identity.sourceCommit ||
          previous.size_bytes !== input.sizeBytes)
      )
        throw new MobileReleaseError("MOBILE_CI_UPLOAD_MISMATCH");
      if (
        previous &&
        (previous.consumed_at ||
          new Date(previous.expires_at).getTime() <= Date.now())
      )
        throw new MobileReleaseError("MOBILE_CI_UPLOAD_EXPIRED_OR_CONSUMED");
      if (!previous)
        await client.query(
          "INSERT INTO public.app_mobile_uploads(ci_run_id,ci_run_attempt,source_commit,build_number,sha256,size_bytes,storage_path,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            identity.runId,
            identity.runAttempt,
            identity.sourceCommit,
            input.buildNumber,
            input.sha256,
            input.sizeBytes,
            path,
            expiresAt,
          ],
        );
      return previous ? iso(previous.expires_at) : expiresAt;
    });
    return {
      path,
      signedUploadUrl: upload.data.signedUrl,
      token: upload.data.token,
      url: prefix + path,
      expiresAt: ledgerExpiresAt,
    };
  }
  static async acceptCi(
    raw: PublishMobileCiRequest,
    identity: MobileCiIdentity,
  ) {
    const input = PublishMobileCiRequestSchema.parse(raw);
    if (input.sourceCommit !== identity.sourceCommit)
      throw new MobileReleaseError("MOBILE_CI_COMMIT_MISMATCH", 422);
    if (input.schemaVersion > FOUNDATION_SCHEMA_VERSION)
      throw new MobileReleaseError("MOBILE_SERVER_SCHEMA_INCOMPATIBLE", 409);
    if (!dbPool) throw new MobileReleaseError("DEPENDENCY_UNAVAILABLE", 503);
    const payloadHash = hash(input);
    const existing = (
      await dbPool.query<ReleaseRow>(
        "SELECT * FROM public.app_mobile_releases WHERE platform=$1 AND ((ci_run_id=$2 AND ci_run_attempt=$3) OR build_number=$4)",
        [
          input.platform,
          identity.runId,
          identity.runAttempt,
          input.buildNumber,
        ],
      )
    ).rows[0];
    if (existing) {
      if (existing.payload_hash !== payloadHash)
        throw new MobileReleaseError("MOBILE_CI_RELEASE_MISMATCH");
      return commerceTransaction((client) =>
        ciReplay(client, existing, identity),
      );
    }
    if (input.platform === "android") {
      const path = mobilePackageStoragePath({ ...input, platform: "android" });
      if (input.url !== prefix + path)
        throw new MobileReleaseError("MOBILE_CI_UPLOAD_MISMATCH", 422);
      const slot = (
        await dbPool.query<{ id: string }>(
          "SELECT id FROM public.app_mobile_uploads WHERE ci_run_id=$1 AND ci_run_attempt=$2 AND source_commit=$3 AND storage_path=$4 AND size_bytes=$5 AND consumed_at IS NULL AND expires_at>clock_timestamp()",
          [
            identity.runId,
            identity.runAttempt,
            identity.sourceCommit,
            path,
            input.sizeBytes,
          ],
        )
      ).rows[0];
      if (!slot)
        throw new MobileReleaseError("MOBILE_CI_UPLOAD_NOT_PREPARED", 422);
      await verifyMobileArtifact(input.url, input.sha256, input.sizeBytes);
    }
    return commerceTransaction(async (client) => {
      const state = await lockState(client);
      const prior = (
        await client.query<ReleaseRow>(
          "SELECT * FROM public.app_mobile_releases WHERE platform=$1 AND ((ci_run_id=$2 AND ci_run_attempt=$3) OR build_number=$4)",
          [
            input.platform,
            identity.runId,
            identity.runAttempt,
            input.buildNumber,
          ],
        )
      ).rows[0];
      if (prior) {
        if (prior.payload_hash !== payloadHash)
          throw new MobileReleaseError("MOBILE_CI_RELEASE_MISMATCH");
        return ciReplay(client, prior, identity);
      }
      if (input.platform === "android") {
        const consumed = await client.query(
          "UPDATE public.app_mobile_uploads SET consumed_at=clock_timestamp() WHERE ci_run_id=$1 AND ci_run_attempt=$2 AND storage_path=$3 AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING id",
          [
            identity.runId,
            identity.runAttempt,
            mobilePackageStoragePath({ ...input, platform: "android" }),
          ],
        );
        if (!consumed.rowCount)
          throw new MobileReleaseError("MOBILE_CI_UPLOAD_NOT_PREPARED", 422);
      }
      const inserted = (
        await client.query<ReleaseRow>(
          `INSERT INTO public.app_mobile_releases(platform,version,build_number,min_supported_build,runtime_fingerprint,source_commit,schema_version,sha256,size_bytes,channel,url,release_notes,signing_identity,ci_run_id,ci_run_attempt,payload_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
          [
            input.platform,
            input.version,
            input.buildNumber,
            input.minSupportedBuild,
            input.runtimeFingerprint,
            input.sourceCommit,
            input.schemaVersion,
            input.sha256,
            input.sizeBytes,
            input.channel,
            input.url,
            input.releaseNotes,
            input.signingIdentity,
            identity.runId,
            identity.runAttempt,
            payloadHash,
          ],
        )
      ).rows[0];
      // An Apple upload is not proof that App Store/TestFlight has processed it.
      const highWater = (
        await client.query<{ build_number: number | null }>(
          "SELECT max(build_number)::integer AS build_number FROM public.app_mobile_releases WHERE platform=$1 AND published_at IS NOT NULL",
          [input.platform],
        )
      ).rows[0].build_number;
      const automatic =
        input.platform === "android" &&
        state.android_auto_publish &&
        Boolean(state.android_signing_identity) &&
        state.android_signing_identity === input.signingIdentity &&
        (highWater === null || input.buildNumber > highWater);
      if (automatic) await activate(client, inserted, state, true);
      const revision = await advance(client, null);
      await event(
        client,
        inserted.id,
        "verified",
        revision,
        null,
        identity.runId,
      );
      if (automatic)
        await event(
          client,
          inserted.id,
          "published",
          revision,
          null,
          identity.runId,
        );
      return {
        status: automatic ? ("published" as const) : ("verified" as const),
        releaseId: inserted.id,
        revision,
      };
    });
  }
}

/** SHA and byte length are verified by streaming from one fixed trusted origin. */
export async function verifyMobileArtifact(
  url: string,
  expectedSha: string,
  expectedSize: number,
  request: typeof fetch = fetch,
) {
  if (
    !url.startsWith(prefix) ||
    !/^android\/\d+\/[a-f0-9]{64}\.apk$/.test(url.slice(prefix.length))
  )
    throw new MobileReleaseError("MOBILE_ARTIFACT_INVALID", 422);
  const response = await request(url, {
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok || !response.body)
    throw new MobileReleaseError("MOBILE_ARTIFACT_UNAVAILABLE", 503);
  const declared = response.headers.get("content-length");
  if (declared && Number(declared) !== expectedSize)
    throw new MobileReleaseError("MOBILE_ARTIFACT_SIZE_MISMATCH", 422);
  const reader = response.body.getReader(),
    digest = createHash("sha256");
  let size = 0,
    prefixBytes = Buffer.alloc(0);
  try {
    for (;;) {
      const value = await reader.read();
      if (value.done) break;
      size += value.value.byteLength;
      if (size > expectedSize || size > 150 * 1024 * 1024)
        throw new MobileReleaseError("MOBILE_ARTIFACT_SIZE_MISMATCH", 422);
      if (prefixBytes.length < 4)
        prefixBytes = Buffer.concat([
          prefixBytes,
          Buffer.from(value.value),
        ]).subarray(0, 4);
      digest.update(value.value);
    }
    if (size !== expectedSize)
      throw new MobileReleaseError("MOBILE_ARTIFACT_SIZE_MISMATCH", 422);
    if (!prefixBytes.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])))
      throw new MobileReleaseError("MOBILE_ARTIFACT_INVALID", 422);
    if (digest.digest("hex") !== expectedSha)
      throw new MobileReleaseError("MOBILE_ARTIFACT_CHECKSUM_MISMATCH", 422);
  } finally {
    await reader.cancel().catch(() => {});
  }
}
