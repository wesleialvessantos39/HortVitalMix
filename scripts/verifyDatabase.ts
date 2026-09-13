import { Pool } from 'pg';
import { loadMigrationConfig } from './migrationConfig';
import {
  acquireMigrationLock,
  assertRemoteHistory,
  loadAndVerifyLocalMigrations,
  readRemoteMigrationHistory,
  releaseMigrationLock,
  verifyCurrentRelease,
} from './migrationRunner';

const config = loadMigrationConfig();
await loadAndVerifyLocalMigrations();
const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
const client = await pool.connect();

try {
  await acquireMigrationLock(client);
  try {
    const remote = await readRemoteMigrationHistory(client);
    assertRemoteHistory(remote, true);
    await verifyCurrentRelease(client, config.environment);
    console.log(`Database verified for ${config.environment}: ${remote.length} migrations and current release match.`);
  } finally {
    await releaseMigrationLock(client);
  }
} finally {
  client.release();
  await pool.end();
}
