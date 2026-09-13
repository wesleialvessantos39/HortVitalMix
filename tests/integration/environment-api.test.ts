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

function probe(overrides: Partial<FoundationProbe> = {}): FoundationProbe {
  return {
    databaseAvailable: true,
    databaseEnvironment: 'homologation',
    releaseVersion: 'oe-001-004',
    schemaVersion: 4,
    migrationIntegrity: 'valid',
    releaseHistoryHashMatches: true,
    ...overrides,
  };
}

function repository(value: FoundationProbe): FoundationRepository {
  return { probe: async () => value };
}

describe('OE-001-003/004 environment and database API', () => {
  it('returns ready only when database, schema and release match', async () => {
    const { app } = createApp({
      runtime: runtime('homologation'),
      pool: null,
      repository: repository(probe()),
    });

    const response = await request(app).get('/api/ready');
    expect(response.status).toBe(200);
    expect(response.body.databaseBinding).toBe('ready');
    expect(response.body.migrationIntegrity).toBe('valid');
    expect(response.body.actualSchemaVersion).toBe(4);
  });

  it('does not silently accept a production database in homologation', async () => {
    const { app } = createApp({
      runtime: runtime('homologation'),
      pool: null,
      repository: repository(probe({ databaseEnvironment: 'production' })),
    });

    const response = await request(app).get('/api/ready');
    expect(response.status).toBe(503);
    expect(response.body.databaseBinding).toBe('mismatch');
    expect(response.body.actualDatabaseEnvironment).toBe('production');
  });

  it('blocks readiness when migration history drifts', async () => {
    const { app } = createApp({
      runtime: runtime('homologation'),
      pool: null,
      repository: repository(probe({
        migrationIntegrity: 'drift',
        releaseHistoryHashMatches: false,
      })),
    });

    const response = await request(app).get('/api/ready');
    expect(response.status).toBe(503);
    expect(response.body.migrationIntegrity).toBe('drift');
  });

  it('exposes safe operational policy without database URLs', async () => {
    const { app } = createApp({
      runtime: runtime('homologation'),
      pool: null,
      repository: repository(probe()),
    });

    const response = await request(app).get('/api/v1/environment');
    expect(response.status).toBe(200);
    expect(response.body.indexing).toBe('noindex');
    expect(response.body.tlsRequired).toBe(true);
    expect(response.body.secureCookies).toBe(true);
    expect(response.body.migrationIntegrity).toBe('valid');
    expect(response.body.expectedSchemaVersion).toBe(4);
    expect(response.body.expectedReleaseVersion).toBe('oe-001-004');
    expect(JSON.stringify(response.body)).not.toContain('postgresql://');
    expect(response.headers['x-robots-tag']).toContain('noindex');
    expect(response.headers['strict-transport-security']).toBeTruthy();
  });
});
