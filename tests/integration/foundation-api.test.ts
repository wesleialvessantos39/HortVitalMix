import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import type { FoundationRepository } from '../../server/repositories/postgresHealthRepository';

function runtime(databaseUrl?: string) {
  return {
    environment: 'homologation' as const,
    appBaseUrl: 'https://homologation.example.test',
    apiPort: 3001,
    databaseUrl,
  };
}

describe('OE-001-001 API behavior', () => {
  it('returns readiness 503 when the database adapter is unavailable', async () => {
    const repository: FoundationRepository = { isAvailable: async () => false };
    const { app } = createApp({ runtime: runtime(), pool: null, repository });
    const response = await request(app).get('/api/ready');
    expect(response.status).toBe(503);
    expect(response.body.status).toBe('unavailable');
  });

  it('returns readiness 200 when the adapter is healthy', async () => {
    const repository: FoundationRepository = { isAvailable: async () => true };
    const { app } = createApp({ runtime: runtime('postgresql://configured'), pool: null, repository });
    const response = await request(app).get('/api/ready');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ready');
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const repository: FoundationRepository = { isAvailable: async () => true };
    const { app } = createApp({ runtime: runtime('postgresql://configured'), pool: null, repository });
    const response = await request(app).get('/api/unknown');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('API_NOT_FOUND');
  });

  it('returns 413 for an oversized JSON payload', async () => {
    const repository: FoundationRepository = { isAvailable: async () => true };
    const { app } = createApp({ runtime: runtime('postgresql://configured'), pool: null, repository });
    const response = await request(app).post('/api/unknown').send({ value: 'x'.repeat(300_000) });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('preserves a valid request id in header and payload', async () => {
    const repository: FoundationRepository = { isAvailable: async () => true };
    const { app } = createApp({ runtime: runtime('postgresql://configured'), pool: null, repository });
    const requestId = '9e3d22d3-c00d-4f06-b5df-f96b76bb2330';
    const response = await request(app).get('/api/health').set('x-request-id', requestId);
    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe(requestId);
    expect(response.body.requestId).toBe(requestId);
  });

  it('does not expose a connection string or internal dependency message on failure', async () => {
    const repository: FoundationRepository = {
      isAvailable: async () => {
        throw new Error('postgresql://user:secret@private-host/database');
      },
    };
    const { app } = createApp({ runtime: runtime('postgresql://configured'), pool: null, repository });
    const response = await request(app).get('/api/ready');
    const serialized = JSON.stringify(response.body);

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(serialized).not.toContain('postgresql://');
    expect(serialized).not.toContain('private-host');
    expect(serialized).not.toContain('secret');
  });
});
