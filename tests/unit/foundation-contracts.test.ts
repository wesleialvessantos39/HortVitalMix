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
  requestId: '9e3d22d3-c00d-4f06-b5df-f96b76bb2330',
};

describe('foundation contracts & runtime configuration', () => {
  it('rejects accidental credential fields at the public boundary in publicConfigSchema', () => {
    const parsed = publicConfigSchema.parse({
      ...publicConfig,
      databaseUrl: 'postgresql://should-not-be-present',
    });

    expect('databaseUrl' in parsed).toBe(false);
  });

  it('validates health response schema correctly', () => {
    const valid = healthResponseSchema.safeParse({
      status: 'ok',
      service: 'hortivitalmix-api',
      presentation: 'available',
      database: 'ready',
      requestId: publicConfig.requestId,
    });
    expect(valid.success).toBe(true);
  });

  it('validates readiness response schema correctly for ready and unavailable states', () => {
    const ready = readinessResponseSchema.safeParse({
      status: 'ready',
      dependencies: { database: 'ready' },
      requestId: publicConfig.requestId,
    });
    expect(ready.success).toBe(true);

    const unavailable = readinessResponseSchema.safeParse({
      status: 'unavailable',
      dependencies: { database: 'unavailable' },
      requestId: publicConfig.requestId,
    });
    expect(unavailable.success).toBe(true);
  });

  it('validates environment response schema correctly', () => {
    const env = environmentResponseSchema.safeParse({
      environment: 'development',
      databaseConfigured: false,
      requestId: publicConfig.requestId,
    });
    expect(env.success).toBe(true);
  });

  it('validates api error schema with standardized codes', () => {
    const err = apiErrorSchema.safeParse({
      error: { code: 'API_NOT_FOUND', message: 'Recurso inexistente' },
      requestId: publicConfig.requestId,
    });
    expect(err.success).toBe(true);
  });

  it('enforces uuid validation in requestIdSchema', () => {
    expect(requestIdSchema.safeParse('not-a-uuid').success).toBe(false);
    expect(requestIdSchema.safeParse(publicConfig.requestId).success).toBe(true);
  });

  it('loads safe defaults without requiring environment variables', () => {
    const config = loadRuntimeConfig({});
    expect(config.environment).toBe('development');
    expect(config.apiPort).toBe(3001);
    expect(config.appBaseUrl).toBe('http://localhost:3000');
    expect(config.databaseUrl).toBeUndefined();
  });

  it('reads the database connection only when the server provides it', () => {
    const config = loadRuntimeConfig({ DATABASE_URL: 'postgresql://server-only' });
    expect(config.databaseUrl).toBe('postgresql://server-only');
  });
});
