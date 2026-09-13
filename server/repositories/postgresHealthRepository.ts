import type { AppEnvironment } from '../../shared/domain';
import type { DatabasePool } from '../db/pool';

export interface FoundationProbe {
  databaseAvailable: boolean;
  databaseEnvironment: AppEnvironment | null;
  releaseVersion: string | null;
}

export interface FoundationRepository {
  probe(): Promise<FoundationProbe>;
}

interface EnvironmentRow {
  environment: AppEnvironment;
  release_version: string;
}

export class PostgresFoundationRepository implements FoundationRepository {
  public constructor(private readonly pool: DatabasePool | null) {}

  public async probe(): Promise<FoundationProbe> {
    if (!this.pool) {
      return {
        databaseAvailable: false,
        databaseEnvironment: null,
        releaseVersion: null,
      };
    }

    try {
      const ping = await this.pool.query<{ ok: number }>('select 1::int as ok');
      if (ping.rows[0]?.ok !== 1) {
        return {
          databaseAvailable: false,
          databaseEnvironment: null,
          releaseVersion: null,
        };
      }

      const identity = await this.pool.query<EnvironmentRow>(
        `select environment, release_version
         from app_releases
         where is_current = true
         order by deployed_at desc
         limit 1`,
      );
      const row = identity.rows[0];
      return {
        databaseAvailable: true,
        databaseEnvironment: row?.environment ?? null,
        releaseVersion: row?.release_version ?? null,
      };
    } catch {
      return {
        databaseAvailable: false,
        databaseEnvironment: null,
        releaseVersion: null,
      };
    }
  }
}
