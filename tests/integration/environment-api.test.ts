import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import type {
  FoundationProbe,
  FoundationRepository,
} from '../../server/repositories/postgresHealthRepository';

function runtime(environment: 'development' | 'homologation' | 'production') {
  return {
    environment,
    deploymentSource: 'explicit' as const,
    appBaseUrl: 'https://example.test',
    apiPort: 3001,
    databaseUrl: 'postgresql://configured',
    indexingAllowed: environment === 'production',
    tlsRequired: environment !== 'development',
    secureCookies: environment !== 'development',
    testTokensEnabled: false,
  };
}

function repository(probe: FoundationProbe): FoundationRepository {
  return { probe: async () => probe };
}

describe('OE-001-003 environment API', () => {
  it('returns ready only when the database belongs to the selected environment', async () => {
    const { app } = createApp({
      runtime: runtime('homologation'),
      pool: null,
      repository: repository({
        databaseAvailable: true,
        databaseEnvironment: 'homologation',
        releaseVersion: 'oe-001-003',
      }),
    });

    const response = await request(app).get('/api/ready');
    expect(response.status).toBe(200);
    expect(response.body.databaseBinding).toBe('ready');
  });

  it('does not silently accept a production database in homologation', async () => {
    const { app } = createApp({
      runtime: runtime('homologation'),
      pool: null,
      repository: repository({
        databaseAvailable: true,
        databaseEnvironment: 'production',
        releaseVersion: 'oe-001-003',
      }),
    });

    const response = await request(app).get('/api/ready');
    expect(response.status).toBe(503);
    expect(response.body.databaseBinding).toBe('mismatch');
    expect(response.body.expectedDatabaseEnvironment).toBe('homologation');
    expect(response.body.actualDatabaseEnvironment).toBe('production');
  });

  it('exposes noindex/TLS/cookie policy without exposing database URLs', async () => {
    const { app } = createApp({
      runtime: runtime('homologation'),
      pool: null,
      repository: repository({
        databaseAvailable: true,
        databaseEnvironment: 'homologation',
        releaseVersion: 'oe-001-003',
      }),
    });

    const response = await request(app).get('/api/v1/environment');
    expect(response.status).toBe(200);
    expect(response.body.indexing).toBe('noindex');
    expect(response.body.tlsRequired).toBe(true);
    expect(response.body.secureCookies).toBe(true);
    expect(response.body.testTokensEnabled).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain('postgresql://');
    expect(response.headers['x-robots-tag']).toContain('noindex');
    expect(response.headers['strict-transport-security']).toBeTruthy();
  });
});
