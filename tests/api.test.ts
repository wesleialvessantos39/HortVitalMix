import request from 'supertest';
import {describe,expect,it} from 'vitest';
import {createApp} from '../api/lib/app.ts';
describe('foundation API',()=>{it('returns liveness with a request id',async()=>{const response=await request(createApp()).get('/api/health');expect(response.status).toBe(200);expect(response.headers['x-request-id']).toBeTruthy();expect(response.body.status).toBe('ok')});it('returns a clean JSON 404',async()=>{const response=await request(createApp()).get('/api/unknown');expect(response.status).toBe(404);expect(response.body.error.code).toBe('NOT_FOUND')})});
