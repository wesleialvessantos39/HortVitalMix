import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import type {
  FoundationProbe,
  FoundationRepository,
} from '../../server/repositories/postgresHealthRepository';

function runtime(databaseUrl?: string) {
  return {
    environment: 'homologation' as const,
    deploymentSource: 'explicit' as const,
    appBaseUrl: 'https://homologation.example.test',
    apiPort: 3001,
    databaseUrl,
    indexingAllowed: false,
    tlsRequired: true,
    secureCookies: true,
    testTokensEnabled: false,
  };
}

function repository(probe: FoundationProbe): FoundationRepository {
  return { probe: async () => probe };
}

describe('OE-001 foundation API behavior', () => {
  it('returns readiness 503 when the database adapter is unavailable', async () => {
    const { app } = createApp({
      runtime: runtime(),
      pool: null,
      repository: repository({
        databaseAvailable: false,
        databaseEnvironment: null,
        releaseVersion: null,
      }),
    });
    const response = await request(app).get('/api/ready');
    expect(response.status).toBe(503);
    expect(response.body.status).toBe('unavailable');
  });

  it('returns readiness 200 when the adapter is healthy and bound to homologation', async () => {
    const { app } = createApp({
      runtime: runtime('postgresql://configured'),
      pool: null,
      repository: repository({
        databaseAvailable: true,
        databaseEnvironment: 'homologation',
        releaseVersion: 'oe-001-003',
      }),
    });
    const response = await request(app).get('/api/ready');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ready');
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const { app } = createApp({
      runtime: runtime('postgresql://configured'),
      pool: null,
      repository: repository({
        databaseAvailable: true,
        databaseEnvironment: 'homologation',
        releaseVersion: 'oe-001-003',
      }),
    });
    const response = await request(app).get('/api/unknown');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('API_NOT_FOUND');
  });

  it('returns 413 for an oversized JSON payload', async () => {
    const { app } = createApp({
      runtime: runtime('postgresql://configured'),
      pool: null,
      repository: repository({
        databaseAvailable: true,
        databaseEnvironment: 'homologation',
        releaseVersion: 'oe-001-003',
      }),
    });
    const response = await request(app).post('/api/unknown').send({ value: 'x'.repeat(300_000) });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('preserves a valid request id in header and payload', async () => {
    const { app } = createApp({
      runtime: runtime('postgresql://configured'),
      pool: null,
      repository: repository({
        databaseAvailable: true,
        databaseEnvironment: 'homologation',
        releaseVersion: 'oe-001-003',
      }),
    });
    const requestId = '9e3d22d3-c00d-4f06-b5df-f96b76bb2330';
    const response = await request(app).get('/api/health').set('x-request-id', requestId);
    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe(requestId);
    expect(response.body.requestId).toBe(requestId);
  });

  it('turns dependency failure into unavailable without leaking secrets', async () => {
    const failingRepository: FoundationRepository = {
      probe: async () => {
        throw new Error('postgresql://user:secret@private-host/database');
      },
    };
    const { app } = createApp({
      runtime: runtime('postgresql://configured'),
      pool: null,
      repository: failingRepository,
    });
    const response = await request(app).get('/api/ready');
    const serialized = JSON.stringify(response.body);

    expect(response.status).toBe(503);
    expect(response.body.databaseBinding).toBe('unavailable');
    expect(serialized).not.toContain('postgresql://');
    expect(serialized).not.toContain('private-host');
    expect(serialized).not.toContain('secret');
  });
});
