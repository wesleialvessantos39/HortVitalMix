import {Pool} from 'pg';
import {getRuntimeConfig} from '../config/runtime';

let pool: Pool | null = null;

export function getDbPool(): Pool {
  if (pool) return pool;

  const {DATABASE_URL} = getRuntimeConfig();
  if (!DATABASE_URL) {
    throw new Error('DATABASE_NOT_CONFIGURED');
  }

  pool = new Pool({
    connectionString: DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: DATABASE_URL.includes('neon.tech') ? {rejectUnauthorized: false} : undefined,
  });

  return pool;
}
