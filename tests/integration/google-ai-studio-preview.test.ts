import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import { loadRuntimeConfig } from '../../server/config/runtime';

describe('Google AI Studio / local single-process presentation', () => {
  it('serves all boot endpoints without requiring environment variables', async () => {
    const runtime = loadRuntimeConfig({});
    const { app } = createApp({ runtime, pool: null });

    const [config, health, environment] = await Promise.all([
      request(app).get('/api/v1/config'),
      request(app).get('/api/health'),
      request(app).get('/api/v1/environment'),
    ]);

    expect(config.status).toBe(200);
    expect(config.body.brand.name).toBe('HortiVitalMix');

    expect(health.status).toBe(200);
    expect(health.body.presentation).toBe('available');
    expect(health.body.database).toBe('unavailable');

    expect(environment.status).toBe(200);
    expect(environment.body.environment).toBe('development');
    expect(environment.body.databaseConfigured).toBe(false);
    expect(environment.body.databaseBinding).toBe('unavailable');
  });

  it('does not pretend persistence is ready when no Neon connection exists', async () => {
    const runtime = loadRuntimeConfig({});
    const { app } = createApp({ runtime, pool: null });

    const readiness = await request(app).get('/api/ready');

    expect(readiness.status).toBe(503);
    expect(readiness.body.status).toBe('unavailable');
    expect(readiness.body.databaseBinding).toBe('unavailable');
  });
});
