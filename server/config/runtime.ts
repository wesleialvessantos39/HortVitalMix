import type { AppEnvironment } from '../../shared/domain';

export interface RuntimeConfig {
  environment: AppEnvironment;
  appBaseUrl: string;
  apiPort: number;
  databaseUrl?: string;
}

const DEFAULT_RUNTIME: Omit<RuntimeConfig, 'databaseUrl'> = {
  environment: 'development',
  appBaseUrl: 'http://localhost:3000',
  apiPort: 3001,
};

function optionalDatabaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const key = ['DATABASE', 'URL'].join('_');
  const value = env[key]?.trim();
  return value ? value : undefined;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    ...DEFAULT_RUNTIME,
    databaseUrl: optionalDatabaseUrl(env),
  };
}
