import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { loadMigrationConfig } from './migrationConfig';

const migrationConfig = loadMigrationConfig();

const migrationsDir = path.resolve(process.cwd(), 'db/migrations');
const files = (await readdir(migrationsDir)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
const pool = new Pool({ connectionString: migrationConfig.databaseUrl, max: 1 });

try {
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const version = Number(file.split('_', 1)[0]);
    const name = file.replace(/^\d+_/, '').replace(/\.sql$/, '');
    const existing = await pool
      .query<{ checksum: string }>('select checksum from app_schema_migrations where version = $1', [version])
      .catch(() => ({ rows: [] as { checksum: string }[] }));

    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(`Migration drift detected at version ${version}.`);
      }
      continue;
    }

    const startedAt = Date.now();
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query(
        'insert into app_schema_migrations(version, name, checksum, execution_ms) values ($1, $2, $3, $4)',
        [version, name, checksum, Date.now() - startedAt],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    console.log(`Applied migration ${version}: ${name} to ${migrationConfig.environment}`);
  }
} finally {
  await pool.end();
}
