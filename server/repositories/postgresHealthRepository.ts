import type { DatabasePool } from '../db/pool';

export interface FoundationRepository {
  isAvailable(): Promise<boolean>;
}

export class PostgresFoundationRepository implements FoundationRepository {
  public constructor(private readonly pool: DatabasePool | null) {}

  public async isAvailable(): Promise<boolean> {
    if (!this.pool) {
      return false;
    }

    try {
      const result = await this.pool.query<{ ok: number }>('select 1::int as ok');
      return result.rows[0]?.ok === 1;
    } catch {
      return false;
    }
  }
}
