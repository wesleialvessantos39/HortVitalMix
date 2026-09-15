import {Pool, type PoolClient} from 'pg';
import {getRuntimeConfig} from './config';

let pool: Pool | undefined;

export function getPool(): Pool {
  const {DATABASE_URL} = getRuntimeConfig();
  if (!DATABASE_URL) throw new Error('DATABASE_NOT_CONFIGURED');
  pool ??= new Pool({connectionString: DATABASE_URL, max: 5, ssl: {rejectUnauthorized: false}});
  return pool;
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
