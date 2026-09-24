import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { decodedJsonBody } from '../../server/middleware/decodedJsonBody.ts';

test('accepts raw, string and Buffer JSON without losing email or portalRole', () => {
  const body = { email: 'user@example.invalid', portalRole: 'platform_super_admin' };
  for (const value of [body, JSON.stringify(body), Buffer.from(JSON.stringify(body))])
    assert.deepEqual(decodedJsonBody(value), body);
  assert.equal(decodedJsonBody(undefined), undefined);
});
test('rejects malformed and oversized serialized bodies', () => {
  for (const value of ['{', 'null', '[]', 'true'])
    assert.throws(() => decodedJsonBody(value), { type: 'entity.parse.failed' });
  assert.throws(() => decodedJsonBody('x'.repeat(32769)), { type: 'entity.too.large' });
});

let pending, pendingError, passwordValid, sent, signedOut, writes;
const client = { auth: {
  signInWithPassword: async () => passwordValid
    ? { data: { user: { id: 'admin-id' }, session: {} }, error: null }
    : { data: {}, error: { message: 'invalid credentials' } },
  signOut: async () => { signedOut++; return { error: null }; },
  signInWithOtp: async () => { sent++; return { error: null }; },
} };
const admin = { from(table) {
  let mutation = false;
  const result = () => mutation ? { error: null } : {
    data: table === 'app_admin_principals' ? { admin_user_id: 'admin-id', email_verified_at: '2026-09-24' }
      : table === 'app_users' ? { status: 'active' }
      : table === 'app_user_role_assignments' ? [{ role_code: 'platform_super_admin', expires_at: null }]
      : pending,
    error: table === 'app_admin_mfa_challenges' ? pendingError : null,
  };
  const query = { then(resolve) { return Promise.resolve(result()).then(resolve); },
    maybeSingle: async () => result(),
    update() { mutation = true; writes++; return query; },
    insert() { mutation = true; writes++; return query; },
  };
  for (const method of ['select', 'eq', 'in', 'is', 'gt', 'order', 'limit']) query[method] = () => query;
  return query;
} };
mock.module('../../server/db/pool.ts', { namedExports: { dbPool: null } });
mock.module('../../server/supabase/client.ts', { namedExports: {
  supabaseAdmin: admin, supabasePublic: client, createSupabasePublicClient: () => client,
} });
const { AdminGovernanceService } = await import('../../server/services/AdminGovernanceService.ts');
AdminGovernanceService.rateLimit = async () => ({ limited: false });
AdminGovernanceService.recordAttempt = async () => {};
beforeEach(() => {
  pending = { id: 'existing-challenge', expires_at: new Date(Date.now() + 60000).toISOString(), attempts: 0, max_attempts: 5 };
  pendingError = null; passwordValid = true; sent = 0; signedOut = 0; writes = 0;
});
const login = () => AdminGovernanceService.login('admin@example.invalid', 'password', 'ip-hash', 'request-id');
test('resumes pending MFA after password validation without another email or invalidation', async () => {
  const result = await login();
  assert.equal(result.status, 'mfa_required');
  assert.equal(result.mfaChallengeId, 'existing-challenge');
  assert.equal(sent, 0); assert.equal(writes, 0); assert.equal(signedOut, 1);
});
test('invalid password cannot retrieve a pending MFA challenge', async () => {
  passwordValid = false;
  assert.equal((await login()).status, 'invalid_credentials');
  assert.equal(sent, 0); assert.equal(writes, 0);
});
test('database failure does not emit a replacement or retain password session', async () => {
  pendingError = { message: 'unavailable' };
  assert.equal((await login()).status, 'unavailable');
  assert.equal(sent, 0); assert.equal(writes, 0); assert.equal(signedOut, 1);
});
test('without a pending challenge, emits MFA and creates a challenge', async () => {
  pending = null;
  assert.equal((await login()).status, 'mfa_required');
  assert.equal(sent, 1); assert.equal(writes, 2);
});
