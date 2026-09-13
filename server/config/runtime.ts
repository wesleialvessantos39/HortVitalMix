import type { AppEnvironment } from '../../shared/domain';
import {
  getEnvironmentPolicy,
  resolveAppEnvironment,
  type DeploymentSource,
} from '../../shared/environment/policy';

export interface RuntimeConfig {
  environment: AppEnvironment;
  deploymentSource: DeploymentSource;
  appBaseUrl: string;
  apiPort: number;
  databaseUrl?: string;
  indexingAllowed: boolean;
  tlsRequired: boolean;
  secureCookies: boolean;
  testTokensEnabled: boolean;
}

function optionalDatabaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const key = ['DATABASE', 'URL'].join('_');
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function resolvePort(env: NodeJS.ProcessEnv): number {
  const raw = [env.API_PORT, env.PORT]
    .map((value) => value?.trim())
    .find((value): value is string => Boolean(value));

  if (!raw) return 3001;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error('Invalid API port.');
  }
  return parsed;
}

function resolveAppBaseUrl(env: NodeJS.ProcessEnv, environment: AppEnvironment): string {
  const explicit = env.APP_BASE_URL?.trim();
  if (explicit) return explicit;

  const vercelHost = environment === 'production'
    ? env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
    : env.VERCEL_URL?.trim();

  if (vercelHost) return `https://${vercelHost}`;
  return 'http://localhost:3000';
}

function resolveTestTokensEnabled(
  env: NodeJS.ProcessEnv,
  environment: AppEnvironment,
): boolean {
  const enabled = env.ENABLE_TEST_TOKENS?.trim().toLowerCase() === 'true';
  if (enabled && environment !== 'development') {
    throw new Error('Test tokens are restricted to development.');
  }
  return enabled && environment === 'development';
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const resolved = resolveAppEnvironment(env);
  const policy = getEnvironmentPolicy(resolved.environment);

  return {
    environment: resolved.environment,
    deploymentSource: resolved.source,
    appBaseUrl: resolveAppBaseUrl(env, resolved.environment),
    apiPort: resolvePort(env),
    databaseUrl: optionalDatabaseUrl(env),
    indexingAllowed: policy.indexingAllowed,
    tlsRequired: policy.tlsRequired,
    secureCookies: policy.secureCookies,
    testTokensEnabled: resolveTestTokensEnabled(env, resolved.environment),
  };
}
