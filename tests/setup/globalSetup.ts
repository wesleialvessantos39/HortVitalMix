import { afterAll, beforeAll } from 'vitest';
import { dbPool, DATABASE_CONFIGURED } from '../../server/db/pool';

function assertNotProduction() {
  const url = process.env.SUPABASE_DB_URL ?? '';
  for (const pattern of [/prod/i, /production/i]) {
    if (pattern.test(url)) {
      throw new Error(`[TEST] SUPABASE_DB_URL parece apontar para produção (${pattern}). Testes abortados.`);
    }
  }
  const prodRef = process.env.HVM_PROD_PROJECT_REF;
  if (prodRef && url.includes(prodRef)) {
    throw new Error(`[TEST] SUPABASE_DB_URL contém project ref de produção (${prodRef}). Testes abortados.`);
  }
}

beforeAll(async () => {
  assertNotProduction();
  if (HAS_INTEGRATION && dbPool) await dbPool.query('select 1');
});

afterAll(async () => {
  if (DATABASE_CONFIGURED && dbPool) await dbPool.end();
});

export const HAS_INTEGRATION =
  process.env.HVM_INTEGRATION_ENABLED === 'true' &&
  DATABASE_CONFIGURED;
