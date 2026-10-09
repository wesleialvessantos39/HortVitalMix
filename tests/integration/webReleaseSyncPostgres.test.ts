import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import manifest from "../../supabase/manifest.json";
const state = vi.hoisted(() => ({
  runtime: { appEnv: "production", commitSha: "b".repeat(40) },
  schema: "", raw: null as Pool | null, observed: null as (() => void) | null,
}));
vi.mock("../../server/config/runtime.ts", () => ({ runtime: state.runtime }));
vi.mock("../../server/db/pool.ts", () => {
  const rewrite = (sql: string) => sql
    .replaceAll("public.app_releases", `${state.schema}.app_releases`)
    .replaceAll("supabase_migrations.schema_migrations", `${state.schema}.schema_migrations`);
  return { dbPool: {
    connect: async () => {
      const client = await state.raw!.connect();
      return {
        query: async (sql: string, values?: unknown[]) => {
          const result = await client.query(rewrite(sql), values);
          if (sql.endsWith("AND is_current=true") && state.observed) {
            const done = state.observed; state.observed = null; done();
          }
          return result;
        },
        release: () => client.release(),
      };
    },
  } };
});
import { WebReleaseSyncService as service } from "../../server/services/WebReleaseSyncService.ts";
const enabled = Boolean(process.env.HVM_WEB_RELEASE_LOCAL_DATABASE_URL);
const shaA = "a".repeat(40), shaB = "b".repeat(40), shaC = "c".repeat(40);
const actor = (commit = shaB, run = "9002") => ({ sourceCommit: commit, runId: run, runAttempt: 1 });
const raw = () => state.raw!;
const table = () => `${state.schema}.app_releases`;
async function seed(commit: string, by = "synthetic-test", isCurrent = true) {
  return (await raw().query(
    `INSERT INTO ${table()}(release_tag,environment,commit_sha,schema_version,migration_history_hash,is_current,deployed_by) VALUES('synthetic-baseline','production',$1,$2,$3,$4,$5) RETURNING id`,
    [commit, manifest.schemaVersion, manifest.migrationHistoryHash, isCurrent, by],
  )).rows[0].id as string;
}
async function snapshot() {
  // Read-only proof on real operational relations. No fixture is inserted there.
  return (await raw().query("SELECT 'global' AS name,count(*)::text AS count,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS digest FROM public.app_global_config t UNION ALL SELECT 'mobile-policy',count(*)::text,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) FROM public.app_mobile_release_policy t ORDER BY name")).rows;
}
describe.runIf(enabled)("Sincronização web em PostgreSQL descartável real", () => {
  beforeAll(async () => {
    const value = process.env.HVM_WEB_RELEASE_LOCAL_DATABASE_URL!;
    const url = new URL(value);
    if (url.hostname !== "127.0.0.1" || url.port !== "55432" || url.pathname !== "/postgres")
      throw new Error("WEB_RELEASE_DISPOSABLE_LOCAL_DATABASE_REQUIRED");
    const pg = (await import("pg")).default;
    state.raw = new pg.Pool({ connectionString: value, max: 8 });
    state.schema = "hvm_web_sync_" + randomUUID().replaceAll("-", "");
    await raw().query(`CREATE SCHEMA ${state.schema}`);
    await raw().query(`CREATE TABLE ${table()} (LIKE public.app_releases INCLUDING ALL)`);
    await raw().query(`CREATE TABLE ${state.schema}.schema_migrations(version text PRIMARY KEY,name text NOT NULL)`);
  });
  beforeEach(async () => {
    state.runtime.appEnv = "production";
    state.runtime.commitSha = shaB;
    state.observed = null;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      appEnv: "production", sourceCommit: state.runtime.commitSha,
      schemaVersion: manifest.schemaVersion, migrationHistoryHash: manifest.migrationHistoryHash,
    }))));
    await raw().query(`TRUNCATE ${table()},${state.schema}.schema_migrations`);
    await raw().query(`INSERT INTO ${state.schema}.schema_migrations(version,name) SELECT version,name FROM jsonb_to_recordset($1::jsonb) AS x(version text,name text)`, [JSON.stringify(manifest.migrations.map(({ version, name }) => ({ version, name })))]);
    await seed(shaA);
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    if (state.raw) {
      if (state.schema) await raw().query(`DROP SCHEMA ${state.schema} CASCADE`);
      await raw().end();
    }
  });
  it("duas publicações simultâneas preservam história e uma única release atual", async () => {
    const before = await snapshot();
    const responses = await Promise.all([service.sync({ sourceCommit: shaB }, actor()), service.sync({ sourceCommit: shaB }, actor())]);
    expect(responses.map((value) => value.status).sort()).toEqual(["idempotent", "synced"]);
    const rows = (await raw().query(`SELECT commit_sha,is_current,deployed_by FROM ${table()} ORDER BY deployed_at`)).rows;
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.is_current)).toHaveLength(1);
    expect(rows[0]).toMatchObject({ commit_sha: shaA, is_current: false });
    expect(rows[1]).toMatchObject({ commit_sha: shaB, is_current: true, deployed_by: "github-actions:9002:1" });
    expect(await snapshot()).toEqual(before);
  });
  it("retry depois de perda da resposta não altera deployed_at nem duplica", async () => {
    await service.sync({ sourceCommit: shaB }, actor());
    const initial = (await raw().query(`SELECT * FROM ${table()} ORDER BY deployed_at`)).rows;
    expect((await service.sync({ sourceCommit: shaB }, { ...actor(), runAttempt: 2 })).status).toBe("idempotent");
    expect((await raw().query(`SELECT * FROM ${table()} ORDER BY deployed_at`)).rows).toEqual(initial);
  });
  it("migração faltante e schema/hash adulterado fazem rollback antes da DML", async () => {
    const original = (await raw().query(`SELECT * FROM ${table()}`)).rows;
    await raw().query(`DELETE FROM ${state.schema}.schema_migrations WHERE version=$1`, [manifest.migrations.at(-1)!.version]);
    await expect(service.sync({ sourceCommit: shaB }, actor())).rejects.toMatchObject({ code: "WEB_MIGRATION_HISTORY_MISMATCH" });
    expect((await raw().query(`SELECT * FROM ${table()}`)).rows).toEqual(original);
    await raw().query(`INSERT INTO ${state.schema}.schema_migrations(version,name) VALUES($1,$2)`, [manifest.migrations.at(-1)!.version, manifest.migrations.at(-1)!.name]);
    await raw().query(`UPDATE ${table()} SET migration_history_hash=$1`, ["f".repeat(64)]);
    await expect(service.sync({ sourceCommit: shaB }, actor())).rejects.toMatchObject({ code: "WEB_SCHEMA_MISMATCH" });
    expect((await raw().query(`SELECT count(*)::int AS count FROM ${table()}`)).rows[0].count).toBe(1);
  });
  it("aliases físicos Supabase são aceitos sem modificar história migrations", async () => {
    await raw().query(`UPDATE ${state.schema}.schema_migrations SET version=CASE version WHEN '20261009023420' THEN '20261009225521' WHEN '20261009170751' THEN '20261009225532' ELSE version END`);
    const before = (await raw().query(`SELECT * FROM ${state.schema}.schema_migrations ORDER BY version`)).rows;
    expect((await service.sync({ sourceCommit: shaB }, actor())).status).toBe("synced");
    expect((await raw().query(`SELECT * FROM ${state.schema}.schema_migrations ORDER BY version`)).rows).toEqual(before);
  });
  it("requisição que aguardou lock não sobrescreve publicação mais recente", async () => {
    const holder = await raw().connect();
    await holder.query("BEGIN");
    await holder.query("SELECT pg_advisory_xact_lock(hashtext('hvm-release-production'))");
    let done!: () => void;
    const observed = new Promise<void>((resolve) => { done = resolve; });
    state.observed = done;
    const pending = service.sync({ sourceCommit: shaB }, actor());
    const checked = expect(pending).rejects.toMatchObject({ code: "WEB_RELEASE_CHANGED" });
    await observed;
    await holder.query(`UPDATE ${table()} SET is_current=false`);
    await holder.query(`INSERT INTO ${table()}(release_tag,environment,commit_sha,schema_version,migration_history_hash,deployed_by) VALUES('synthetic-newer','production',$1,$2,$3,'github-actions:9003:1')`, [shaC, manifest.schemaVersion, manifest.migrationHistoryHash]);
    await holder.query("COMMIT");
    holder.release();
    await checked;
    expect((await raw().query(`SELECT commit_sha FROM ${table()} WHERE is_current`)).rows[0].commit_sha).toBe(shaC);
  });
  it("run atrasado não ultrapassa high-water e dispatch novo não reativa SHA antiga", async () => {
    await raw().query(`UPDATE ${table()} SET is_current=false`);
    await seed(shaC, "github-actions:9003:1");
    await expect(service.sync({ sourceCommit: shaB }, actor())).rejects.toMatchObject({ code: "WEB_CI_RUN_NOT_NEWER" });
    state.runtime.commitSha = shaA;
    await expect(service.sync({ sourceCommit: shaA }, actor(shaA, "9004"))).rejects.toMatchObject({ code: "WEB_RELEASE_ALREADY_ARCHIVED" });
    expect((await raw().query(`SELECT commit_sha FROM ${table()} WHERE is_current`)).rows[0].commit_sha).toBe(shaC);
  });
});
