import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('OE-001-002 Neon homologation', () => {
  it('has migration 0002, revisioned configuration and optimistic concurrency', async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();

    try {
      const migration = await client.query<{ name: string; checksum: string }>(
        'select name, checksum from app_schema_migrations where version = 2',
      );
      expect(migration.rows[0]?.name).toBe('oe_001_002_global_configuration');
      expect(migration.rows[0]?.checksum).toBe(
        'e8c77e4a32c7006a1d4d8292586b695895b528786021f97c8e54e9bf94a98e68',
      );

      const config = await client.query<{ revision: string; city: string; email: string | null }>(
        `select revision::text, region_city as city, support_email as email
         from app_global_config where singleton_key = 'global'`,
      );
      expect(Number(config.rows[0]?.revision)).toBeGreaterThan(0);
      expect(config.rows[0]?.city).toBe('Ariquemes');
      expect(config.rows[0]?.email).toBeNull();

      await client.query('BEGIN');
      const revision = Number(config.rows[0]?.revision);
      const first = await client.query(
        `update app_global_config
         set revision = revision + 1
         where singleton_key = 'global' and revision = $1`,
        [revision],
      );
      const second = await client.query(
        `update app_global_config
         set revision = revision + 1
         where singleton_key = 'global' and revision = $1`,
        [revision],
      );

      expect(first.rowCount).toBe(1);
      expect(second.rowCount).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
      await pool.end();
    }
  });
});
