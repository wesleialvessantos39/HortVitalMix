import { APP_ENVIRONMENTS, type AppEnvironment } from '../shared/domain';

export interface MigrationConfig {
  environment: AppEnvironment;
  databaseUrl: string;
}

export function loadMigrationConfig(env: NodeJS.ProcessEnv = process.env): MigrationConfig {
  const environment = env.MIGRATION_ENV?.trim();
  if (!environment || !APP_ENVIRONMENTS.includes(environment as AppEnvironment)) {
    throw new Error('MIGRATION_ENV must explicitly be development, homologation, or production.');
  }

  const databaseUrl = env.DATABASE_MIGRATION_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_MIGRATION_URL is required. Runtime DATABASE_URL is never used for migrations.');
  }

  return {
    environment: environment as AppEnvironment,
    databaseUrl,
  };
}
