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

describe('foundation contracts & runtime configuration', () => {
  it('rejects accidental credential fields at the public boundary in publicConfigSchema', () => {
    const parsed = publicConfigSchema.parse({
      brand: { name: 'HortiVitalMix', tagline: 'Do produtor local para a sua mesa' },
      locale: 'pt-BR',
      market: { city: 'Ariquemes', state: 'RO' },
      presentationMode: true,
      requestId: '9e3d22d3-c00d-4f06-b5df-f96b76bb2330',
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
      requestId: '9e3d22d3-c00d-4f06-b5df-f96b76bb2330',
    });
    expect(valid.success).toBe(true);
  });

  it('validates readiness response schema correctly for ready and unavailable states', () => {
    const ready = readinessResponseSchema.safeParse({
      status: 'ready',
      dependencies: { database: 'ready' },
      requestId: '9e3d22d3-c00d-4f06-b5df-f96b76bb2330',
    });
    expect(ready.success).toBe(true);

    const unavailable = readinessResponseSchema.safeParse({
      status: 'unavailable',
      dependencies: { database: 'unavailable' },
      requestId: '9e3d22d3-c00d-4f06-b5df-f96b76bb2330',
    });
    expect(unavailable.success).toBe(true);
  });

  it('validates environment response schema correctly', () => {
    const env = environmentResponseSchema.safeParse({
      environment: 'development',
      databaseConfigured: false,
      requestId: '9e3d22d3-c00d-4f06-b5df-f96b76bb2330',
    });
    expect(env.success).toBe(true);
  });

  it('validates api error schema with standardized codes', () => {
    const err = apiErrorSchema.safeParse({
      error: { code: 'API_NOT_FOUND', message: 'Recurso inexistente' },
      requestId: '9e3d22d3-c00d-4f06-b5df-f96b76bb2330',
    });
    expect(err.success).toBe(true);
  });

  it('enforces uuid validation in requestIdSchema', () => {
    expect(requestIdSchema.safeParse('not-a-uuid').success).toBe(false);
    expect(requestIdSchema.safeParse('9e3d22d3-c00d-4f06-b5df-f96b76bb2330').success).toBe(true);
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
