import { describe, expect, it } from 'vitest';
import {
  EXPECTED_MIGRATIONS,
  EXPECTED_MIGRATION_HISTORY_HASH,
} from '../../shared/database/migrationManifest';
import {
  calculateMigrationHistoryHash,
  inspectMigrationHistory,
  type AppliedMigration,
} from '../../server/db/migrationIntegrity';

describe('OE-001-004 migration integrity', () => {
  it('keeps the canonical migration history hash stable', () => {
    expect(calculateMigrationHistoryHash(EXPECTED_MIGRATIONS)).toBe(
      EXPECTED_MIGRATION_HISTORY_HASH,
    );
  });

  it('detects an edited applied file checksum', () => {
    const remote: AppliedMigration[] = EXPECTED_MIGRATIONS.map((item) => ({ ...item }));
    remote[1] = { ...remote[1], checksum: '0'.repeat(64) };

    const result = inspectMigrationHistory(remote);

    expect(result.status).toBe('drift');
    expect(result.detail).toBe('checksum_mismatch');
  });

  it('detects an unexpected legacy 0014 history instead of rewriting it', () => {
    const remote: AppliedMigration[] = [
      ...EXPECTED_MIGRATIONS,
      {
        version: 14,
        name: 'oe_003_001_profile_data_contact',
        checksum: '8'.repeat(64),
      },
    ];

    const result = inspectMigrationHistory(remote);

    expect(result.status).toBe('drift');
    expect(result.detail).toBe('unexpected_remote_version');
  });

  it('accepts only the known prefix while the next migration is pending', () => {
    const result = inspectMigrationHistory(
      EXPECTED_MIGRATIONS.slice(0, 3),
      EXPECTED_MIGRATIONS,
      false,
    );

    expect(result.status).toBe('valid');
    expect(result.detail).toBe('pending');
  });
});
