import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { validProviderOtp, PROVIDER_OTP_LENGTH, hasConfirmedEmail } from '../../shared/securityCodes.ts';

test('provider accepts all eight digits, including leading zeros, without truncation', () => {
  assert.equal(PROVIDER_OTP_LENGTH, 8);
  assert.equal(validProviderOtp('01234567'), true);
  for (const invalid of ['123456', '1234567', '123456789', '1234abcd', '12 34567'])
    assert.equal(validProviderOtp(invalid), false);
});
test('missing, empty or invalid confirmation timestamp never grants access', () => {
  for (const user of [null, undefined, {}, { email_confirmed_at: null }, { email_confirmed_at: '' }, { email_confirmed_at: 'invalid' }])
    assert.equal(hasConfirmedEmail(user), false);
  assert.equal(hasConfirmedEmail({ email_confirmed_at: '2026-09-24T10:00:00Z' }), true);
});

let authUser;
let resolved = 0;
mock.module('../../server/supabase/client.ts', { namedExports: {
  supabaseAdmin: { auth: { getUser: async () => ({ data: { user: authUser }, error: null }) } },
} });
mock.module('../../server/services/IdentityAccessService.ts', { namedExports: {
  resolveIdentityAccess: async () => { resolved++; return { liveSession: true, status: 'active', roles: ['consumer'], personId: 'person' }; },
} });
mock.module('../../server/config/reportFailure.ts', { namedExports: { reportFailure() {} } });
const { sessionMiddleware } = await import('../../server/middleware/session.ts');
const token = 'header.' + Buffer.from(JSON.stringify({ session_id: '00000000-0000-4000-8000-000000000001' })).toString('base64url') + '.signature';
test('unconfirmed user cannot recover protected access through a previous cookie or bearer token', async () => {
  authUser = { id: 'user', email_confirmed_at: null };
  for (const headers of [{ cookie: 'hvm_access=' + token }, { authorization: 'Bearer ' + token }]) {
    const req = { path: '/v1/protected', headers, actor: { userId: 'stale' } };
    let continued = false;
    await sessionMiddleware(req, { locals: {} }, () => { continued = true; });
    assert.equal(req.actor, null);
    assert.equal(continued, true);
  }
  assert.equal(resolved, 0);
});
test('confirmed user with live session and active role can access protected routes', async () => {
  authUser = { id: 'user', email: 'user@example.invalid', email_confirmed_at: '2026-09-24T10:00:00Z' };
  const req = { path: '/v1/protected', headers: { cookie: 'hvm_access=' + token } };
  await sessionMiddleware(req, { locals: {} }, () => {});
  assert.equal(req.actor.userId, 'user');
  assert.deepEqual(req.actor.roles, ['consumer']);
});
