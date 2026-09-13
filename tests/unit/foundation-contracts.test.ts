import { describe, expect, it } from 'vitest';
import {
  apiErrorSchema,
  environmentResponseSchema,
  healthResponseSchema,
  publicConfigSchema,
  readinessResponseSchema,
  requestIdSchema,
} from '../../shared/contracts/foundation';
import { loadRuntimeConfig } from '../../server/config/runtime';

const requestId = '9e3d22d3-c00d-4f06-b5df-f96b76bb2330';

const publicConfig = {
  revision: 1,
  source: 'database' as const,
  brand: {
    name: 'HortiVitalMix' as const,
    tagline: 'Do produtor local para a sua mesa',
    pageTitle: 'HortiVitalMix | Do produtor local para a sua mesa',
    logoAltText: 'HortiVitalMix - do produtor local para a sua mesa',
    theme: {
      primary: '#0F4D2F',
      secondary: '#78A936',
      accent: '#EF6500',
    },
  },
  contacts: { email: null, phone: null, whatsapp: null },
  region: { countryCode: 'BR', stateCode: 'RO', city: 'Ariquemes' },
  parameters: { locale: 'pt-BR', currency: 'BRL', timezone: 'America/Porto_Velho' },
  requestId,
};

describe('foundation contracts & runtime configuration', () => {
  it('rejects accidental credential fields at the public boundary in publicConfigSchema', () => {
    expect(publicConfigSchema.safeParse({
      ...publicConfig,
      databaseUrl: 'postgresql://should-not-be-present',
    }).success).toBe(false);
  });

  it('validates health response schema correctly', () => {
    expect(healthResponseSchema.safeParse({
      status: 'ok',
      service: 'hortivitalmix-api',
      presentation: 'available',
      environment: 'homologation',
      database: 'ready',
      databaseBinding: 'ready',
      migrationIntegrity: 'valid',
      requestId,
    }).success).toBe(true);
  });

  it('validates readiness response schema correctly', () => {
    expect(readinessResponseSchema.safeParse({
      status: 'ready',
      environment: 'homologation',
      dependencies: { database: 'ready' },
      databaseBinding: 'ready',
      migrationIntegrity: 'valid',
      expectedDatabaseEnvironment: 'homologation',
      actualDatabaseEnvironment: 'homologation',
      expectedSchemaVersion: 4,
      actualSchemaVersion: 4,
      expectedReleaseVersion: 'oe-001-004',
      releaseVersion: 'oe-001-004',
      requestId,
    }).success).toBe(true);
  });

  it('validates environment response schema correctly', () => {
    expect(environmentResponseSchema.safeParse({
      environment: 'development',
      deploymentSource: 'local',
      databaseConfigured: false,
      databaseBinding: 'unavailable',
      databaseEnvironment: null,
      migrationIntegrity: 'unavailable',
      expectedSchemaVersion: 4,
      schemaVersion: null,
      expectedReleaseVersion: 'oe-001-004',
      releaseVersion: null,
      indexing: 'noindex',
      tlsRequired: false,
      secureCookies: false,
      testTokensEnabled: false,
      requestId,
    }).success).toBe(true);
  });

  it('validates api error schema with standardized codes', () => {
    expect(apiErrorSchema.safeParse({
      error: { code: 'API_NOT_FOUND', message: 'Recurso inexistente' },
      requestId,
    }).success).toBe(true);
  });

  it('enforces uuid validation in requestIdSchema', () => {
    expect(requestIdSchema.safeParse('not-a-uuid').success).toBe(false);
    expect(requestIdSchema.safeParse(requestId).success).toBe(true);
  });

  it('loads safe defaults without requiring environment variables', () => {
    const config = loadRuntimeConfig({});
    expect(config.environment).toBe('development');
    expect(config.apiPort).toBe(3001);
    expect(config.appBaseUrl).toBe('http://localhost:3000');
    expect(config.databaseUrl).toBeUndefined();
    expect(config.indexingAllowed).toBe(false);
  });

  it('reads the runtime database connection only when the server provides it', () => {
    const config = loadRuntimeConfig({ DATABASE_URL: 'postgresql://server-only' });
    expect(config.databaseUrl).toBe('postgresql://server-only');
  });
});
