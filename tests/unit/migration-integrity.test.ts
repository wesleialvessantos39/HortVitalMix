import { describe, expect, it } from 'vitest';
import {
  EXPECTED_MIGRATIONS,
  EXPECTED_MIGRATION_HISTORY_HASH,
} from '../../shared/database/migrationManifest';
import {
  calculateMigrationHistoryHash,
  inspectMigrationHistory,
} from '../../server/db/migrationIntegrity';
import { loadAndVerifyLocalMigrations } from '../../scripts/migrationRunner';
import type { AppliedMigration } from '../../server/db/migrationIntegrity';

describe('OE-001-004 migration integrity', () => {
  it('matches every local SQL file against the immutable manifest', async () => {
    const migrations = await loadAndVerifyLocalMigrations();
    expect(migrations).toHaveLength(4);
    expect(migrations.map((item) => item.version)).toEqual([1, 2, 3, 4]);
    expect(calculateMigrationHistoryHash(migrations)).toBe(EXPECTED_MIGRATION_HISTORY_HASH);
  });

  it('detects an edited applied file checksum', () => {
    const remote: AppliedMigration[] = EXPECTED_MIGRATIONS.map((item) => ({ ...item }));
    remote[1] = { ...remote[1], checksum: '0'.repeat(64) };
    const result = inspectMigrationHistory(remote);
    expect(result.status).toBe('drift');
    expect(result.detail).toBe('checksum_mismatch');
  });

  it('detects an unexpected legacy 0014 history instead of rewriting it', () => {
    const remote = [
      ...EXPECTED_MIGRATIONS,
      { version: 14, name: 'oe_003_001_profile_data_contact', checksum: '8'.repeat(64) },
    ];
    const result = inspectMigrationHistory(remote);
    expect(result.status).toBe('drift');
    expect(result.detail).toBe('unexpected_remote_version');
  });

  it('reports a valid prefix as pending before a new migration is applied', () => {
    const result = inspectMigrationHistory(EXPECTED_MIGRATIONS.slice(0, 3), EXPECTED_MIGRATIONS, false);
    expect(result.status).toBe('valid');
    expect(result.detail).toBe('pending');
  });
});
