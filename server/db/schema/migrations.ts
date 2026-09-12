/**
 * TypeScript representation of canonical database schema: app_schema_migrations
 * Fonte normativa: HortiVitalMix Manual Mestre Técnico Greenfield v6 (Módulo 001 - OE-001-001)
 */

export interface AppSchemaMigrationRow {
  version: number;
  name: string;
  checksum: string;
  execution_ms: number;
  applied_at: Date;
}
