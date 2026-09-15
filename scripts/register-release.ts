import {createHash} from 'node:crypto';
import 'dotenv/config';
import {getRuntimeConfig} from '../server/config/runtime';
import {getDbPool} from '../server/db/pool';

const {APP_ENV, APP_RELEASE} = getRuntimeConfig();
const commitSha = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA;

if (!commitSha || !/^[0-9a-f]{40}$/i.test(commitSha)) {
  throw new Error('GIT_COMMIT_SHA ou VERCEL_GIT_COMMIT_SHA deve conter um SHA Git de 40 caracteres.');
}

const pool = getDbPool();
const client = await pool.connect();

try {
  await client.query('BEGIN');

  const migrations = await client.query<{version: number; checksum_sha256: string}>(
    'SELECT version, checksum_sha256 FROM app_schema_migrations ORDER BY version',
  );

  if (!migrations.rowCount) {
    throw new Error('Nenhuma migration aplicada; release não pode ser registrada.');
  }

  const schemaVersion = migrations.rows[migrations.rows.length - 1].version;
  const historyHash = createHash('sha256')
    .update(migrations.rows.map((row) => `${row.version}:${row.checksum_sha256}`).join('|'))
    .digest('hex');

  await client.query(
    'UPDATE app_releases SET is_current = false WHERE environment = $1 AND is_current = true',
    [APP_ENV],
  );

  await client.query(
    `INSERT INTO app_releases (
       release_tag,
       environment,
       commit_sha,
       schema_version,
       migration_history_hash,
       is_current,
       deployed_at,
       git_commit,
       released_at
     )
     VALUES ($1, $2, $3, $4, $5, true, clock_timestamp(), $3, clock_timestamp())
     ON CONFLICT (git_commit, environment)
     DO UPDATE SET
       release_tag = EXCLUDED.release_tag,
       commit_sha = EXCLUDED.commit_sha,
       schema_version = EXCLUDED.schema_version,
       migration_history_hash = EXCLUDED.migration_history_hash,
       is_current = true,
       deployed_at = clock_timestamp(),
       released_at = clock_timestamp()`,
    [APP_RELEASE, APP_ENV, commitSha, schemaVersion, historyHash],
  );

  await client.query('COMMIT');
  console.log(
    `Release ${APP_RELEASE} registrada em ${APP_ENV} com schema v${schemaVersion}.`,
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
