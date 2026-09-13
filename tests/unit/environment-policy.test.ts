import { describe, expect, it } from 'vitest';
import {
  getEnvironmentPolicy,
  resolveAppEnvironment,
} from '../../shared/environment/policy';
import { loadRuntimeConfig } from '../../server/config/runtime';
import { loadMigrationConfig } from '../../scripts/migrationConfig';

describe('OE-001-003 environment policy', () => {
  it('maps Vercel preview to homologation and production explicitly', () => {
    expect(resolveAppEnvironment({ VERCEL_ENV: 'preview' }).environment).toBe('homologation');
    expect(resolveAppEnvironment({ VERCEL_ENV: 'production' }).environment).toBe('production');
  });

  it('keeps local development as the safe default', () => {
    expect(resolveAppEnvironment({})).toEqual({
      environment: 'development',
      source: 'local',
    });
  });

  it('resolves COR 05 when port variables are empty', () => {
    const config = loadRuntimeConfig({ API_PORT: '', PORT: '' });
    expect(config.apiPort).toBe(3001);
  });

  it('rejects malformed non-empty ports', () => {
    expect(() => loadRuntimeConfig({ API_PORT: 'abc' })).toThrow('Invalid API port.');
  });

  it('keeps indexing disabled outside production', () => {
    expect(getEnvironmentPolicy('development').indexingAllowed).toBe(false);
    expect(getEnvironmentPolicy('homologation').indexingAllowed).toBe(false);
    expect(getEnvironmentPolicy('production').indexingAllowed).toBe(true);
  });

  it('requires secure cookies and TLS outside development', () => {
    expect(getEnvironmentPolicy('development').secureCookies).toBe(false);
    expect(getEnvironmentPolicy('homologation').secureCookies).toBe(true);
    expect(getEnvironmentPolicy('production').tlsRequired).toBe(true);
  });

  it('rejects test tokens outside development', () => {
    expect(() => loadRuntimeConfig({
      HORTIVITALMIX_ENV: 'homologation',
      ENABLE_TEST_TOKENS: 'true',
    })).toThrow('Test tokens are restricted to development.');
  });

  it('requires a dedicated migration URL and explicit migration environment', () => {
    expect(() => loadMigrationConfig({
      MIGRATION_ENV: 'homologation',
      DATABASE_URL: 'postgresql://runtime-only',
    })).toThrow('DATABASE_MIGRATION_URL is required');

    expect(loadMigrationConfig({
      MIGRATION_ENV: 'homologation',
      DATABASE_MIGRATION_URL: 'postgresql://migration-only',
      DATABASE_URL: 'postgresql://runtime-only',
    })).toEqual({
      environment: 'homologation',
      databaseUrl: 'postgresql://migration-only',
    });
  });
});
