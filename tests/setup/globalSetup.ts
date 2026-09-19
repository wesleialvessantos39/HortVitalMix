import { afterAll, beforeAll } from 'vitest';
import { dbPool } from '../../server/db/pool';

beforeAll(async () => {
  if (process.env.HVM_INTEGRATION_ENABLED !== 'true') return;
  if (!dbPool) throw new Error('INTEGRATION_DB_REQUIRED: SUPABASE_DB_URL não configurada.');
  await dbPool.query('select 1');
});

afterAll(async () => {
  // O pool é encerrado pelo runner/processo. Testes individuais limpam seus fixtures.
});
