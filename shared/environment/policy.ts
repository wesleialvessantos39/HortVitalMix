import { APP_ENVIRONMENTS, type AppEnvironment } from '../domain';

export type DeploymentSource = 'explicit' | 'vercel' | 'local';

export interface ResolvedEnvironment {
  environment: AppEnvironment;
  source: DeploymentSource;
}

export interface EnvironmentPolicy {
  indexingAllowed: boolean;
  tlsRequired: boolean;
  secureCookies: boolean;
  testTokensAllowed: boolean;
}

function isAppEnvironment(value: string): value is AppEnvironment {
  return APP_ENVIRONMENTS.includes(value as AppEnvironment);
}

function readExplicitEnvironment(env: NodeJS.ProcessEnv): string | undefined {
  const preferredKey = ['HORTIVITALMIX', 'ENV'].join('_');
  const legacyKey = ['APP', 'ENV'].join('_');
  return env[preferredKey]?.trim() || env[legacyKey]?.trim() || undefined;
}

export function resolveAppEnvironment(env: NodeJS.ProcessEnv = process.env): ResolvedEnvironment {
  const explicit = readExplicitEnvironment(env);
  if (explicit) {
    if (!isAppEnvironment(explicit)) {
      throw new Error('Invalid HortiVitalMix environment.');
    }
    return { environment: explicit, source: 'explicit' };
  }

  const vercelEnvironment = env.VERCEL_ENV?.trim();
  if (vercelEnvironment) {
    if (vercelEnvironment === 'production') {
      return { environment: 'production', source: 'vercel' };
    }
    if (vercelEnvironment === 'preview') {
      return { environment: 'homologation', source: 'vercel' };
    }
    if (vercelEnvironment === 'development') {
      return { environment: 'development', source: 'vercel' };
    }
    throw new Error('Unsupported Vercel environment.');
  }

  return { environment: 'development', source: 'local' };
}

export function getEnvironmentPolicy(environment: AppEnvironment): EnvironmentPolicy {
  const production = environment === 'production';
  const development = environment === 'development';
  return {
    indexingAllowed: production,
    tlsRequired: !development,
    secureCookies: !development,
    testTokensAllowed: development,
  };
}
