import {createHash} from 'node:crypto';
import {readdir, readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {resolve} from 'node:path';
import 'dotenv/config';
import {getPool} from '../api/lib/db.ts';

const lockId = 74813001;
const directory = resolve('migrations');
const files = (await readdir(directory)).filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort();
const client = await getPool().connect();

try {
  await client.query('SELECT pg_advisory_lock($1)', [lockId]);
  for (const file of files) {
    const sql = await readFile(resolve(directory, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const version = Number(file.slice(0, 4));
    const existing = await client.query<{checksum_sha256: string}>('SELECT checksum_sha256 FROM app_schema_migrations WHERE version = $1', [version]);
    if (existing.rowCount) {
      if (existing.rows[0].checksum_sha256 !== checksum) throw new Error(`Migration ${version} divergiu do histórico aplicado.`);
      continue;
    }
    const started = performance.now();
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO app_schema_migrations (version, name, checksum_sha256, execution_ms) VALUES ($1, $2, $3, $4)', [version, file, checksum, Math.round(performance.now() - started)]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  await client.query('SELECT pg_advisory_unlock($1)', [lockId]);
  client.release();
  await getPool().end();
}
