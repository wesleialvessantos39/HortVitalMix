import { Pool } from 'pg';
import type { RuntimeConfig } from '../config/runtime';

export type DatabasePool = Pool;

export function createDatabasePool(config: RuntimeConfig): DatabasePool | null {
  if (!config.databaseUrl) {
    return null;
  }

  return new Pool({
    connectionString: config.databaseUrl,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
}
