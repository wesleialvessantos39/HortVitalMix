import request from 'supertest';
import {beforeEach, describe, expect, it} from 'vitest';
import {createApp} from '../api/[...path].ts';

describe('Trilha 01 - foundation API', () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    process.env.APP_ENV = 'development';
  });

  it('retorna liveness conforme o contrato v7', async () => {
    const response = await request(createApp()).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(response.body.status).toBe('ok');
    expect(response.body.environment).toBe('development');
    expect(Number.isNaN(Date.parse(response.body.time))).toBe(false);
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it('retorna 503 unavailable sem vazar DATABASE_URL quando o Neon está ausente', async () => {
    const response = await request(createApp()).get('/api/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('unavailable');
    expect(response.body.databaseConnected).toBe(false);
    expect(response.body.schemaVersion).toBe(0);
    expect(response.body.releaseTag).toBe('');
    expect(JSON.stringify(response.body)).not.toContain('postgresql://');
  });

  it('retorna JSON 404 limpo para rota inexistente', async () => {
    const response = await request(createApp()).get('/api/unknown');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.requestId).toBeTruthy();
  });
});
