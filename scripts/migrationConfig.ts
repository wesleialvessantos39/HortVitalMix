import { APP_ENVIRONMENTS, type AppEnvironment } from '../shared/domain';

export interface MigrationConfig {
  environment: AppEnvironment;
  databaseUrl: string;
  commitSha: string;
  artifactRef: string | null;
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

  const commitSha = env.MIGRATION_COMMIT_SHA?.trim().toLowerCase();
  if (!commitSha || !/^[0-9a-f]{40}$/.test(commitSha)) {
    throw new Error('MIGRATION_COMMIT_SHA must be a full 40-character Git commit SHA.');
  }

  return {
    environment: environment as AppEnvironment,
    databaseUrl,
    commitSha,
    artifactRef: env.MIGRATION_ARTIFACT_REF?.trim() || null,
  };
}
