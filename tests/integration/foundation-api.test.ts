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
});
