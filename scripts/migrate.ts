import {createHash} from 'node:crypto';
import {readdir, readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {resolve} from 'node:path';
import 'dotenv/config';
import {Pool} from 'pg';

const lockId = 74813001;
const directory = resolve('migrations');
const files = (await readdir(directory))
  .filter((file) => /^\d{4}_.+\.sql$/.test(file))
  .sort();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL não configurada.');

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  ssl: databaseUrl.includes('neon.tech') ? {rejectUnauthorized: false} : undefined,
});
const client = await pool.connect();

async function historyTableExists(): Promise<boolean> {
  const result = await client.query<{exists: boolean}>(
    "SELECT to_regclass('public.app_schema_migrations') IS NOT NULL AS exists",
  );
  return result.rows[0]?.exists === true;
}

try {
  await client.query('SELECT pg_advisory_lock($1)', [lockId]);

  let hasHistoryTable = await historyTableExists();

  for (const file of files) {
    const sql = await readFile(resolve(directory, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const version = Number(file.slice(0, 4));

    if (hasHistoryTable) {
      const existing = await client.query<{checksum_sha256: string}>(
        'SELECT checksum_sha256 FROM app_schema_migrations WHERE version = $1',
        [version],
      );

      if (existing.rowCount) {
        if (existing.rows[0]?.checksum_sha256 !== checksum) {
          throw new Error(
            `Migration ${version} divergiu do histórico aplicado; execução interrompida antes de qualquer mudança.`,
          );
        }
        continue;
      }
    } else if (version !== 1) {
      throw new Error(
        'Histórico de migrations ausente e a primeira migration disponível não é a versão 0001.',
      );
    }

    const started = performance.now();
    await client.query('BEGIN');

    try {
      await client.query(sql);

      if (!(await historyTableExists())) {
        throw new Error(
          `Migration ${version} não criou app_schema_migrations; histórico não pode ser registrado.`,
        );
      }

      await client.query(
        `INSERT INTO app_schema_migrations
          (version, name, checksum_sha256, execution_ms)
         VALUES ($1, $2, $3, $4)`,
        [version, file, checksum, Math.max(0, Math.round(performance.now() - started))],
      );

      await client.query('COMMIT');
      hasHistoryTable = true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  try {
    await client.query('SELECT pg_advisory_unlock($1)', [lockId]);
  } finally {
    client.release();
    await pool.end();
  }
}
