import { z } from "zod";
import { randomUUID } from "node:crypto";
import manifest from "../../supabase/manifest.json" with { type: "json" };
import { FOUNDATION_SCHEMA_VERSION } from "../../shared/contracts/foundation.ts";
import { validateHistory } from "../../shared/migrationHistory.ts";
import { dbPool } from "../db/pool.ts";
import { runtime } from "../config/runtime.ts";
import type { MobileCiIdentity } from "../security/mobileCiIdentity.ts";

export const WebReleaseSyncRequestSchema = z.object({
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
}).strict();
export type WebReleaseSyncRequest = z.infer<typeof WebReleaseSyncRequestSchema>;
export const WEB_RELEASE_CI_ORIGIN = "https://hortvitalmix.vercel.app";
export const WebReleaseRuntimeStatusSchema = z.object({
  appEnv: z.literal("production"),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  schemaVersion: z.number().int().positive(),
  migrationHistoryHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
type CanonicalStatus = z.infer<typeof WebReleaseRuntimeStatusSchema>;
export async function probeCanonicalWebRuntime(): Promise<CanonicalStatus> {
  try {
    const response = await fetch(
      `${WEB_RELEASE_CI_ORIGIN}/api/v1/mobile-ci/web-release/status?nonce=${randomUUID()}`,
      { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(3000), headers: { "Cache-Control": "no-cache" } },
    );
    if (!response.ok) throw new Error("Canonical status unavailable");
    return WebReleaseRuntimeStatusSchema.parse(await response.json());
  } catch { throw new WebReleaseSyncError("WEB_CANONICAL_STATUS_UNAVAILABLE", 503); }
}

export class WebReleaseSyncError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
type Release = {
  id: string;
  release_tag: string;
  commit_sha: string;
  schema_version: number;
  migration_history_hash: string;
};
const currentSql = "SELECT id,release_tag,commit_sha,schema_version,migration_history_hash FROM public.app_releases WHERE environment='production' AND is_current=true";
const identitySchema = z.object({
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  runId: z.string().regex(/^\d{1,30}$/),
  runAttempt: z.number().int().min(1).max(999999999),
});
function result(row: Release, status: "synced" | "idempotent") {
  return {
    status, releaseTag: row.release_tag, sourceCommit: row.commit_sha,
    schemaVersion: row.schema_version, migrationHistoryHash: row.migration_history_hash,
  };
}

/** Only release metadata changes. Migration SQL and operational tables are never written. */
export const WebReleaseSyncService = {
  async sync(input: WebReleaseSyncRequest, authenticated: MobileCiIdentity, options?: {
    /** Internal test seam. The HTTP route never forwards client dependencies. */
    probe?: () => Promise<CanonicalStatus>;
  }) {
    const identity = identitySchema.safeParse(authenticated);
    const payload = WebReleaseSyncRequestSchema.safeParse(input);
    if (!identity.success) throw new WebReleaseSyncError("MOBILE_CI_UNAUTHORIZED", 401);
    if (!payload.success) throw new WebReleaseSyncError("VALIDATION_FAILED", 422);
    if (runtime.appEnv !== "production")
      throw new WebReleaseSyncError("WEB_PRODUCTION_REQUIRED", 409);
    if (payload.data.sourceCommit !== identity.data.sourceCommit)
      throw new WebReleaseSyncError("WEB_CI_COMMIT_MISMATCH", 409);
    if (runtime.commitSha !== identity.data.sourceCommit)
      throw new WebReleaseSyncError("WEB_DEPLOYMENT_PENDING", 409);
    if (manifest.schemaVersion !== FOUNDATION_SCHEMA_VERSION || !/^[a-f0-9]{64}$/.test(manifest.migrationHistoryHash))
      throw new WebReleaseSyncError("WEB_SCHEMA_MISMATCH", 503);
    if (!dbPool) throw new WebReleaseSyncError("WEB_RELEASE_UNAVAILABLE", 503);

    const client = await dbPool.connect().catch(() => {
      throw new WebReleaseSyncError("WEB_RELEASE_UNAVAILABLE", 503);
    });
    let began = false;
    try {
      // Compare the row observed on arrival with the row after the common lock:
      // a request waiting behind a newer publication cannot overwrite it.
      const observed = (await client.query<Release>(currentSql)).rows[0];
      await client.query("BEGIN");
      began = true;
      await client.query("SELECT pg_advisory_xact_lock(hashtext('hvm-release-production'))");
      const history = (await client.query<{ version: string; name: string }>(
        "SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version",
      )).rows;
      try { validateHistory(history); }
      catch { throw new WebReleaseSyncError("WEB_MIGRATION_HISTORY_MISMATCH", 503); }
      const current = (await client.query<Release>(currentSql + " FOR UPDATE")).rows[0];
      const canonical = WebReleaseRuntimeStatusSchema.safeParse(
        await (options?.probe ?? probeCanonicalWebRuntime)(),
      );
      if (!canonical.success)
        throw new WebReleaseSyncError("WEB_CANONICAL_STATUS_UNAVAILABLE", 503);
      if (canonical.data.sourceCommit !== identity.data.sourceCommit)
        throw new WebReleaseSyncError("WEB_DEPLOYMENT_PENDING", 409);
      if (canonical.data.schemaVersion !== FOUNDATION_SCHEMA_VERSION || canonical.data.migrationHistoryHash !== manifest.migrationHistoryHash)
        throw new WebReleaseSyncError("WEB_SCHEMA_MISMATCH", 503);
      if (current?.schema_version && (current.schema_version > FOUNDATION_SCHEMA_VERSION ||
        (current.schema_version === FOUNDATION_SCHEMA_VERSION && current.migration_history_hash !== manifest.migrationHistoryHash)))
        throw new WebReleaseSyncError("WEB_SCHEMA_MISMATCH", 503);
      if (current?.commit_sha === identity.data.sourceCommit) {
        if (current.schema_version !== FOUNDATION_SCHEMA_VERSION || current.migration_history_hash !== manifest.migrationHistoryHash)
          throw new WebReleaseSyncError("WEB_SCHEMA_MISMATCH", 503);
        await client.query("COMMIT");
        began = false;
        return result(current, "idempotent");
      }
      if (observed?.id !== current?.id)
        throw new WebReleaseSyncError("WEB_RELEASE_CHANGED", 409);

      // Run IDs are signed GitHub claims. iat is not a deployment sequence: a
      // delayed old job can obtain a new token. Retain the high-water mark in
      // history, including releases later archived by a manual publication.
      const highWater = (await client.query<{ run_id: string | null }>(
        "SELECT max((substring(deployed_by FROM '^github-actions:([0-9]{1,30}):[0-9]{1,9}$'))::numeric)::text AS run_id FROM public.app_releases WHERE environment='production'",
      )).rows[0]?.run_id;
      if (highWater && BigInt(identity.data.runId) <= BigInt(highWater))
        throw new WebReleaseSyncError("WEB_CI_RUN_NOT_NEWER", 409);
      if ((await client.query(
        "SELECT 1 FROM public.app_releases WHERE environment='production' AND commit_sha=$1 LIMIT 1",
        [identity.data.sourceCommit],
      )).rowCount)
        throw new WebReleaseSyncError("WEB_RELEASE_ALREADY_ARCHIVED", 409);
      await client.query("UPDATE public.app_releases SET is_current=false WHERE environment='production' AND is_current=true");
      const sealed = (await client.query<Release>(
        "INSERT INTO public.app_releases(release_tag,environment,commit_sha,schema_version,migration_history_hash,deployed_by,notes) VALUES($1,'production',$2,$3,$4,$5,$6) RETURNING id,release_tag,commit_sha,schema_version,migration_history_hash",
        [
          `auto-web-v${FOUNDATION_SCHEMA_VERSION}-${identity.data.sourceCommit.slice(0, 12)}`,
          identity.data.sourceCommit, FOUNDATION_SCHEMA_VERSION, manifest.migrationHistoryHash,
          `github-actions:${identity.data.runId}:${identity.data.runAttempt}`,
          JSON.stringify({ source: "verified-github-oidc", runId: identity.data.runId, runAttempt: identity.data.runAttempt, operationalDataUnchanged: true }),
        ],
      )).rows[0];
      await client.query("COMMIT");
      began = false;
      return result(sealed, "synced");
    } catch (error) {
      if (began) await client.query("ROLLBACK").catch(() => {});
      if (error instanceof WebReleaseSyncError) throw error;
      throw new WebReleaseSyncError("WEB_RELEASE_UNAVAILABLE", 503);
    } finally { client.release(); }
  },
};
