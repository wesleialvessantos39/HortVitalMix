import { createHash } from 'node:crypto';
import {
  EXPECTED_MIGRATIONS,
  EXPECTED_MIGRATION_HISTORY_HASH,
  type ExpectedMigration,
} from '../../shared/database/migrationManifest';

export type MigrationIntegrityStatus = 'valid' | 'incomplete' | 'drift' | 'unavailable';

export interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
}

export interface MigrationInspection {
  status: MigrationIntegrityStatus;
  currentVersion: number | null;
  historyHash: string | null;
  detail: 'ok' | 'pending' | 'unexpected_remote_version' | 'name_mismatch' | 'checksum_mismatch' | 'non_contiguous_history';
}

export function calculateMigrationHistoryHash(rows: readonly AppliedMigration[]): string {
  return createHash('sha256')
    .update(rows.map((row) => `${row.version}:${row.name}:${row.checksum}`).join('\n'))
    .digest('hex');
}

export function inspectMigrationHistory(
  remoteRows: readonly AppliedMigration[],
  expected: readonly ExpectedMigration[] = EXPECTED_MIGRATIONS,
  requireComplete = true,
): MigrationInspection {
  const rows = [...remoteRows].sort((a, b) => a.version - b.version);

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const wanted = expected[index];
    if (!wanted || row.version !== wanted.version) {
      return {
        status: 'drift',
        currentVersion: rows.at(-1)?.version ?? null,
        historyHash: rows.length ? calculateMigrationHistoryHash(rows) : null,
        detail: index > 0 && row.version !== rows[index - 1].version + 1
          ? 'non_contiguous_history'
          : 'unexpected_remote_version',
      };
    }
    if (row.name !== wanted.name) {
      return { status: 'drift', currentVersion: rows.at(-1)?.version ?? null, historyHash: calculateMigrationHistoryHash(rows), detail: 'name_mismatch' };
    }
    if (row.checksum !== wanted.checksum) {
      return { status: 'drift', currentVersion: rows.at(-1)?.version ?? null, historyHash: calculateMigrationHistoryHash(rows), detail: 'checksum_mismatch' };
    }
  }

  if (rows.length < expected.length) {
    return {
      status: requireComplete ? 'incomplete' : 'valid',
      currentVersion: rows.at(-1)?.version ?? null,
      historyHash: rows.length ? calculateMigrationHistoryHash(rows) : null,
      detail: 'pending',
    };
  }

  const historyHash = calculateMigrationHistoryHash(rows);
  if (expected === EXPECTED_MIGRATIONS && historyHash !== EXPECTED_MIGRATION_HISTORY_HASH) {
    return { status: 'drift', currentVersion: rows.at(-1)?.version ?? null, historyHash, detail: 'checksum_mismatch' };
  }
  return { status: 'valid', currentVersion: rows.at(-1)?.version ?? null, historyHash, detail: 'ok' };
}
