import { dbPool } from "../server/db/pool.ts";
import { runtime } from "../server/config/runtime.ts";
import { parseArgs } from "./args.ts";
import { migrationHash, validateHistory } from "./migrations-manifest.ts";
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (
    !/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(args.tag ?? "") ||
    !/^[a-f0-9]{40}$/.test(args.sha ?? "") ||
    args.environment !== runtime.appEnv
  )
    throw new Error("INVALID_RELEASE_ARGUMENTS");
  if (!dbPool) throw new Error("DATABASE_NOT_CONFIGURED");
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('hvm-release-'||$1))",
      [args.environment],
    );
    const history = await client.query(
      "SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version",
    );
    const schema = validateHistory(history.rows);
    const hash = migrationHash();
    await client.query(
      "UPDATE public.app_releases SET is_current=false WHERE environment=$1 AND is_current=true",
      [args.environment],
    );
    await client.query(
      "INSERT INTO public.app_releases(release_tag,environment,commit_sha,schema_version,migration_history_hash,deployed_by,notes) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        args.tag,
        args.environment,
        args.sha,
        schema,
        hash,
        args.by ?? "operator",
        args.notes ?? null,
      ],
    );
    await client.query("COMMIT");
    console.log(
      JSON.stringify({
        releaseTag: args.tag,
        environment: args.environment,
        schemaVersion: schema,
        commitSha: args.sha,
        hash,
      }),
    );
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
main()
  .catch(() => {
    console.error("RELEASE_NOT_REGISTERED");
    process.exitCode = 1;
  })
  .finally(() => dbPool?.end());
