import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PoolClient } from 'pg';
import {
  EXPECTED_MIGRATIONS,
  EXPECTED_MIGRATION_HISTORY_HASH,
  EXPECTED_RELEASE_VERSION,
  EXPECTED_SCHEMA_VERSION,
  MIGRATION_ADVISORY_LOCK_KEY,
} from '../shared/database/migrationManifest';
import type { AppEnvironment } from '../shared/domain';
import { inspectMigrationHistory, type AppliedMigration } from '../server/db/migrationIntegrity';

export interface LocalMigration extends AppliedMigration {
  file: string;
  sql: string;
}

export async function loadAndVerifyLocalMigrations(
  migrationsDir = path.resolve(process.cwd(), 'db/migrations'),
): Promise<LocalMigration[]> {
  const names = (await readdir(migrationsDir)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  if (names.length !== EXPECTED_MIGRATIONS.length) {
    throw new Error(`Local migration set differs from expected manifest: ${names.length}/${EXPECTED_MIGRATIONS.length}.`);
  }

  const migrations: LocalMigration[] = [];
  for (let index = 0; index < names.length; index += 1) {
    const file = names[index];
    const match = /^(\d{4})_(.+)\.sql$/.exec(file);
    if (!match) throw new Error(`Invalid migration filename: ${file}.`);
    const bytes = await readFile(path.join(migrationsDir, file));
    const migration = {
      version: Number(match[1]),
      name: match[2],
      checksum: createHash('sha256').update(bytes).digest('hex'),
      file,
      sql: bytes.toString('utf8'),
    };
    const expected = EXPECTED_MIGRATIONS[index];
    if (migration.version !== expected.version || migration.name !== expected.name || migration.checksum !== expected.checksum) {
      throw new Error(`Local migration drift detected at ${file}. Applied migration files are immutable.`);
    }
    migrations.push(migration);
  }
  return migrations;
}

export async function readRemoteMigrationHistory(client: PoolClient): Promise<AppliedMigration[]> {
  const relation = await client.query<{ relation: string | null }>(
    "select to_regclass('public.app_schema_migrations')::text as relation",
  );
  if (!relation.rows[0]?.relation) return [];
  const result = await client.query<{ version: string; name: string; checksum: string }>(
    'select version::text, name, checksum from app_schema_migrations order by version',
  );
  return result.rows.map((row) => ({ version: Number(row.version), name: row.name, checksum: row.checksum }));
}

export function assertRemoteHistory(rows: readonly AppliedMigration[], requireComplete: boolean): void {
  const inspection = inspectMigrationHistory(rows, EXPECTED_MIGRATIONS, requireComplete);
  if (inspection.status === 'drift' || (requireComplete && inspection.status !== 'valid')) {
    throw new Error(`Remote migration history is invalid: ${inspection.detail} at version ${inspection.currentVersion ?? 0}.`);
  }
}

export async function acquireMigrationLock(client: PoolClient): Promise<void> {
  await client.query('select pg_advisory_lock($1::bigint)', [MIGRATION_ADVISORY_LOCK_KEY]);
}

export async function releaseMigrationLock(client: PoolClient): Promise<void> {
  await client.query('select pg_advisory_unlock($1::bigint)', [MIGRATION_ADVISORY_LOCK_KEY]);
}

export async function applyPendingMigrations(
  client: PoolClient,
  migrations: readonly LocalMigration[],
  environment: AppEnvironment,
): Promise<void> {
  let remote = await readRemoteMigrationHistory(client);
  assertRemoteHistory(remote, false);
  const applied = new Set(remote.map((item) => item.version));

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    const expectedNext = (remote.at(-1)?.version ?? 0) + 1;
    if (migration.version !== expectedNext) {
      throw new Error(`Migration sequence violation: expected ${expectedNext}, received ${migration.version}.`);
    }
    const startedAt = Date.now();
    await client.query('begin');
    try {
      await client.query(migration.sql);
      await client.query(
        'insert into app_schema_migrations(version, name, checksum, execution_ms) values ($1,$2,$3,$4)',
        [migration.version, migration.name, migration.checksum, Date.now() - startedAt],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
    remote = [...remote, { version: migration.version, name: migration.name, checksum: migration.checksum }];
    console.log(`Applied migration ${migration.version}: ${migration.name} to ${environment}`);
  }
  assertRemoteHistory(await readRemoteMigrationHistory(client), true);
}

export async function registerCurrentRelease(
  client: PoolClient,
  input: { environment: AppEnvironment; commitSha: string; artifactRef: string | null },
): Promise<void> {
  await client.query('begin');
  try {
    await client.query('update app_releases set is_current = false where is_current = true');
    await client.query(
      `insert into app_releases(
        id, environment, release_version, commit_sha, artifact_ref, is_current,
        schema_version, migration_history_hash, deployed_at
      ) values ($1,$2,$3,$4,$5,true,$6,$7,now())`,
      [randomUUID(), input.environment, EXPECTED_RELEASE_VERSION, input.commitSha, input.artifactRef, EXPECTED_SCHEMA_VERSION, EXPECTED_MIGRATION_HISTORY_HASH],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

export async function verifyCurrentRelease(client: PoolClient, environment: AppEnvironment): Promise<void> {
  const result = await client.query<{
    environment: AppEnvironment;
    release_version: string;
    schema_version: string | null;
    migration_history_hash: string | null;
  }>(
    `select environment, release_version, schema_version::text, migration_history_hash
     from app_releases where is_current = true order by deployed_at desc limit 1`,
  );
  const row = result.rows[0];
  if (!row) throw new Error('Current release is missing.');
  if (row.environment !== environment) throw new Error(`Current release environment mismatch: ${row.environment}.`);
  if (row.release_version !== EXPECTED_RELEASE_VERSION) throw new Error(`Current release version mismatch: ${row.release_version}.`);
  if (Number(row.schema_version) !== EXPECTED_SCHEMA_VERSION) throw new Error(`Current schema version mismatch: ${row.schema_version ?? 'null'}.`);
  if (row.migration_history_hash !== EXPECTED_MIGRATION_HISTORY_HASH) throw new Error('Current release migration history hash mismatch.');
}
