import type { AppEnvironment } from '../../shared/domain';
import {
  EXPECTED_MIGRATION_HISTORY_HASH,
  EXPECTED_RELEASE_VERSION,
  EXPECTED_SCHEMA_VERSION,
} from '../../shared/database/migrationManifest';
import type { DatabasePool } from '../db/pool';
import {
  inspectMigrationHistory,
  type AppliedMigration,
  type MigrationIntegrityStatus,
} from '../db/migrationIntegrity';

export interface FoundationProbe {
  databaseAvailable: boolean;
  databaseEnvironment: AppEnvironment | null;
  releaseVersion: string | null;
  schemaVersion: number | null;
  migrationIntegrity: MigrationIntegrityStatus;
  releaseHistoryHashMatches: boolean;
}

export interface FoundationRepository {
  probe(): Promise<FoundationProbe>;
}

interface EnvironmentRow {
  environment: AppEnvironment;
  release_version: string;
  schema_version: string | null;
  migration_history_hash: string | null;
}

export class PostgresFoundationRepository implements FoundationRepository {
  public constructor(private readonly pool: DatabasePool | null) {}

  public async probe(): Promise<FoundationProbe> {
    if (!this.pool) return this.unavailable();

    try {
      const ping = await this.pool.query<{ ok: number }>('select 1::int as ok');
      if (ping.rows[0]?.ok !== 1) return this.unavailable();
    } catch {
      return this.unavailable();
    }

    let migrations: AppliedMigration[];
    try {
      const history = await this.pool.query<{ version: string; name: string; checksum: string }>(
        'select version::text, name, checksum from app_schema_migrations order by version',
      );
      migrations = history.rows.map((row) => ({
        version: Number(row.version),
        name: row.name,
        checksum: row.checksum,
      }));
    } catch {
      return {
        databaseAvailable: true,
        databaseEnvironment: null,
        releaseVersion: null,
        schemaVersion: null,
        migrationIntegrity: 'incomplete',
        releaseHistoryHashMatches: false,
      };
    }

    const inspection = inspectMigrationHistory(migrations);
    let release: EnvironmentRow | undefined;
    try {
      const result = await this.pool.query<EnvironmentRow>(
        'select environment, release_version, schema_version::text, migration_history_hash from app_releases where is_current = true order by deployed_at desc limit 1',
      );
      release = result.rows[0];
    } catch {
      release = undefined;
    }

    return {
      databaseAvailable: true,
      databaseEnvironment: release?.environment ?? null,
      releaseVersion: release?.release_version ?? null,
      schemaVersion: release?.schema_version ? Number(release.schema_version) : null,
      migrationIntegrity: inspection.status,
      releaseHistoryHashMatches:
        inspection.status === 'valid'
        && inspection.historyHash === EXPECTED_MIGRATION_HISTORY_HASH
        && release?.migration_history_hash === EXPECTED_MIGRATION_HISTORY_HASH
        && release?.release_version === EXPECTED_RELEASE_VERSION
        && Number(release?.schema_version) === EXPECTED_SCHEMA_VERSION,
    };
  }

  private unavailable(): FoundationProbe {
    return {
      databaseAvailable: false,
      databaseEnvironment: null,
      releaseVersion: null,
      schemaVersion: null,
      migrationIntegrity: 'unavailable',
      releaseHistoryHashMatches: false,
    };
  }
}
