import { describe, expect, it } from 'vitest';
import { EXPECTED_MIGRATIONS } from '../../shared/database/migrationManifest';
import { inspectMigrationHistory } from '../../server/db/migrationIntegrity';

describe('OE-001-004 migration integrity', () => {
  it('accepts the canonical history', () => {
    const result = inspectMigrationHistory([
      ...EXPECTED_MIGRATIONS,
    ]);

    expect(result.status).toBe('valid');
    expect(result.detail).toBe('ok');
  });

  it('detects an edited checksum', () => {
    const changed = EXPECTED_MIGRATIONS.map((item, index) => ({
      version: item.version,
      name: item.name,
      checksum: index === 1 ? '0000000000000000000000000000000000000000000000000000000000000000' : item.checksum,
    }));

    const result = inspectMigrationHistory(changed);

    expect(result.status).toBe('drift');
    expect(result.detail).toBe('checksum_mismatch');
  });

  it('rejects unexpected legacy version 0014 instead of rewriting history', () => {
    const result = inspectMigrationHistory([
      ...EXPECTED_MIGRATIONS,
      {
        version: 14,
        name: 'oe_003_001_profile_data_contact',
        checksum: '8888888888888888888888888888888888888888888888888888888888888888',
      },
    ]);

    expect(result.status).toBe('drift');
    expect(result.detail).toBe('unexpected_remote_version');
  });
});
