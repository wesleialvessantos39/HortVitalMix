import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('Neon homologation foundation', () => {
  it('connects to PostgreSQL and finds the applied OE-001-001 migration', async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    try {
      const ping = await pool.query<{ ok: number }>('select 1::int as ok');
      expect(ping.rows[0]?.ok).toBe(1);

      const history = await pool.query<{ version: string; name: string; checksum: string }>(
        'select version::text, name, checksum from app_schema_migrations where version = 1',
      );
      expect(history.rows[0]?.name).toBe('oe_001_001_foundation');
      expect(history.rows[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await pool.end();
    }
  });
});
