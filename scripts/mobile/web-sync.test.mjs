import test from 'node:test';
import assert from 'node:assert/strict';
import {
  syncWebRelease, WebReleaseSyncError, WEB_RELEASE_ORIGIN, WEB_RELEASE_STATUS_URL,
  WEB_RELEASE_SYNC_URL, WEB_SYNC_TIMEOUT_MS, WEB_SYNC_RETRY_MS,
} from './sync-web-release.mjs';

const sourceCommit = 'a'.repeat(40);
const previousCommit = 'c'.repeat(40);
const manifest = { schemaVersion: 68, migrationHistoryHash: 'b'.repeat(64) };
const env = { GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'push', GITHUB_SHA: sourceCommit };
const status = { appEnv: 'production', sourceCommit, ...manifest };
const receipt = { status: 'synced', releaseTag: 'web-v68-aaaaaaa-123', sourceCommit, ...manifest };
const syntheticToken = 'synthetic-oidc-' + 't'.repeat(110);

function response(code, body, extra = {}) {
  return { status: code, redirected: false, json: async () => body, ...extra };
}

function harness(sequence, options = {}) {
  let time = 0, tokens = 0;
  const requests = [], messages = [], waits = [];
  const dependencies = {
    env, manifest,
    now: () => time,
    delay: async (milliseconds) => { waits.push(milliseconds); time += milliseconds; },
    getToken: async () => { tokens += 1; return syntheticToken + tokens; },
    log: (message) => messages.push(message),
    fetch: async (url, init) => {
      requests.push({ url, init });
      const entry = sequence.shift();
      assert.ok(entry, 'An unexpected request must not reach a real backend.');
      if (entry instanceof Error) throw entry;
      return typeof entry === 'function' ? await entry(url, init) : entry;
    },
    ...options,
  };
  return {
    run: () => syncWebRelease(dependencies), requests, messages, waits,
    tokenCount: () => tokens, time: () => time,
    advance: (milliseconds) => { time += milliseconds; },
  };
}

test('exact main SHA synchronizes only with the fixed canonical backend and a fresh bearer', async () => {
  const h = harness([response(200, status), response(200, receipt)], {
    env: { ...env, HVM_MOBILE_CI_ORIGIN: 'https://untrusted.example', HVM_NATIVE_BACKEND_ORIGIN: 'https://other.example' },
  });
  assert.deepEqual(await h.run(), receipt);
  assert.equal(h.tokenCount(), 1);
  const [probe, publication] = h.requests;
  const probeUrl = new URL(probe.url);
  assert.equal(probeUrl.origin + probeUrl.pathname, WEB_RELEASE_STATUS_URL);
  assert.equal(probe.init.method, 'GET');
  assert.equal(probe.init.headers, undefined);
  assert.equal(publication.url, WEB_RELEASE_SYNC_URL);
  assert.equal(publication.init.headers.Origin, WEB_RELEASE_ORIGIN);
  assert.equal(publication.init.headers.Authorization, `Bearer ${syntheticToken}1`);
  assert.deepEqual(JSON.parse(publication.init.body), { sourceCommit });
  for (const call of h.requests) {
    assert.equal(call.init.credentials, 'omit');
    assert.equal(call.init.cache, 'no-store');
    assert.equal(call.init.redirect, 'error');
    assert.ok(call.init.signal instanceof AbortSignal);
    assert.equal(new URL(call.url).pathname.includes('/ready'), false);
  }
  assert.equal(h.messages.some((message) => message.includes(syntheticToken)), false);
});

test('workflow dispatch on main accepts an idempotent receipt', async () => {
  const expected = { ...receipt, status: 'idempotent' };
  const h = harness([response(200, status), response(200, expected)], { env: { ...env, GITHUB_EVENT_NAME: 'workflow_dispatch' } });
  assert.deepEqual(await h.run(), expected);
});

test('pull requests, other refs, untrusted events and shortened SHAs fail before network or identity', async () => {
  for (const overrides of [
    { GITHUB_REF: 'refs/pull/12/merge', GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_EVENT_NAME: 'pull_request_target' },
    { GITHUB_EVENT_NAME: 'schedule' },
    { GITHUB_SHA: 'aaaaaaa' },
    { GITHUB_SHA: 'A'.repeat(40) },
  ]) {
    const h = harness([], { env: { ...env, ...overrides } });
    await assert.rejects(h.run(), /WEB_SYNC_EVENT_REJECTED/);
    assert.equal(h.requests.length, 0);
    assert.equal(h.tokenCount(), 0);
  }
});

test('build manifest is validated before any network operation', async () => {
  for (const invalid of [{ ...manifest, schemaVersion: 0 }, { ...manifest, migrationHistoryHash: 'not-a-hash' }]) {
    const h = harness([], { manifest: invalid });
    await assert.rejects(h.run(), /WEB_SYNC_BUILD_MANIFEST_INVALID/);
    assert.equal(h.requests.length, 0);
  }
});

test('stale deployments wait without requesting identity and probes carry different nonces', async () => {
  const h = harness([
    response(200, { ...status, sourceCommit: previousCommit, schemaVersion: 66 }),
    response(200, status), response(200, receipt),
  ]);
  assert.deepEqual(await h.run(), receipt);
  assert.deepEqual(h.waits, [WEB_SYNC_RETRY_MS]);
  assert.equal(h.tokenCount(), 1);
  assert.notEqual(h.requests[0].url, h.requests[1].url);
  assert.equal(h.requests[0].init.method, 'GET');
  assert.equal(h.requests[1].init.method, 'GET');
});

test('old-code 401/404 and transient GET 5xx remain bounded retries', async () => {
  const h = harness([
    response(401, { error: 'SESSION_REQUIRED' }), response(404, {}),
    response(500, {}), response(503, {}), response(200, status), response(200, receipt),
  ]);
  assert.deepEqual(await h.run(), receipt);
  assert.equal(h.waits.length, 4);
  assert.equal(h.tokenCount(), 1);
  assert.ok(h.messages.some((message) => message.includes('WEB_SYNC_STATUS_HTTP_401')));
});

test('malformed or non-production status fails closed without bearer publication', async () => {
  for (const invalid of [
    { ...status, appEnv: 'homologation' },
    { ...status, sourceCommit: 'short' },
    { ...status, schemaVersion: '68' },
    { ...status, migrationHistoryHash: 'unknown' },
    { ...status, unexpected: true },
    null,
  ]) {
    const h = harness([response(200, invalid)]);
    await assert.rejects(h.run(), /WEB_SYNC_STATUS_INVALID/);
    assert.equal(h.tokenCount(), 0);
  }
});

test('target SHA with a different schema or migration hash never publishes', async () => {
  for (const invalid of [{ ...status, schemaVersion: 67 }, { ...status, migrationHistoryHash: 'd'.repeat(64) }]) {
    const h = harness([response(200, invalid)]);
    await assert.rejects(h.run(), /WEB_SYNC_STATUS_MANIFEST_MISMATCH/);
    assert.equal(h.tokenCount(), 0);
  }
});

test('a pending POST is retried through a fresh status probe and a fresh OIDC token', async () => {
  const h = harness([
    response(200, status), response(409, { error: 'WEB_DEPLOYMENT_PENDING' }),
    response(200, status), response(200, receipt),
  ]);
  assert.deepEqual(await h.run(), receipt);
  assert.equal(h.tokenCount(), 2);
  assert.deepEqual(h.waits, [WEB_SYNC_RETRY_MS]);
  assert.notEqual(h.requests[1].init.headers.Authorization, h.requests[3].init.headers.Authorization);
});

test('transient POST 503 retries, while schema, history and stale-run conflicts are fatal', async () => {
  for (const code of ['WEB_CANONICAL_STATUS_UNAVAILABLE', 'WEB_RELEASE_UNAVAILABLE']) {
    const h = harness([
      response(200, status), response(503, { error: code }),
      response(200, status), response(200, receipt),
    ]);
    assert.deepEqual(await h.run(), receipt);
    assert.equal(h.waits.length, 1);
  }
  for (const [http, code] of [
    [503, 'WEB_SCHEMA_MISMATCH'], [503, 'WEB_MIGRATION_HISTORY_MISMATCH'],
    [409, 'WEB_RELEASE_CHANGED'], [409, 'WEB_CI_RUN_NOT_NEWER'], [409, 'WEB_RELEASE_ALREADY_ARCHIVED'],
    [409, 'unknown-private-response'], [503, 'unknown-private-response'],
  ]) {
    const h = harness([response(200, status), response(http, { error: code })]);
    await assert.rejects(h.run(), code.startsWith('WEB_') ? new RegExp(code) : /WEB_SYNC_POST_HTTP_REJECTED/);
    assert.equal(h.waits.length, 0);
  }
});

test('POST authentication and origin failures are fatal rather than repeated', async () => {
  for (const http of [401, 403]) {
    const h = harness([response(200, status), response(http, { error: 'redacted' })]);
    await assert.rejects(h.run(), /WEB_SYNC_IDENTITY_REJECTED/);
    assert.equal(h.waits.length, 0);
    assert.equal(h.tokenCount(), 1);
  }
});

test('redirects are never followed or accepted for status or synchronization', async () => {
  for (const redirectedResponse of [response(302, {}), response(200, status, { redirected: true })]) {
    const h = harness([redirectedResponse]);
    await assert.rejects(h.run(), /WEB_SYNC_STATUS_REDIRECT_REJECTED/);
    assert.equal(h.tokenCount(), 0);
  }
  for (const redirectedResponse of [response(307, {}), response(200, receipt, { redirected: true })]) {
    const h = harness([response(200, status), redirectedResponse]);
    await assert.rejects(h.run(), /WEB_SYNC_POST_REDIRECT_REJECTED/);
  }
});

test('receipt confirms exact SHA, schema, hash, status and strict field set', async () => {
  for (const invalid of [
    { ...receipt, sourceCommit: previousCommit }, { ...receipt, schemaVersion: 66 },
    { ...receipt, migrationHistoryHash: 'd'.repeat(64) }, { ...receipt, status: 'accepted' },
    { ...receipt, releaseTag: 'arbitrary html' }, { ...receipt, extra: 'unknown' }, null,
  ]) {
    const h = harness([response(200, status), response(200, invalid)]);
    await assert.rejects(h.run(), /WEB_SYNC_RECEIPT_INVALID/);
    assert.equal(h.waits.length, 0);
  }
});

test('malformed JSON produces fixed diagnostics without reflecting response contents', async () => {
  const hidden = 'synthetic-private-token-response';
  for (const stage of ['status', 'receipt']) {
    const broken = response(200, {}, { json: async () => { throw new Error(hidden); } });
    const h = harness(stage === 'status' ? [broken] : [response(200, status), broken]);
    await assert.rejects(h.run(), (error) => {
      assert.ok(error instanceof WebReleaseSyncError);
      assert.equal(error.message.includes(hidden), false);
      return true;
    });
  }
});

test('network failures retry safely and never include thrown tokens in diagnostics', async () => {
  const privateMessage = 'network error ' + syntheticToken;
  const h = harness([
    new Error(privateMessage), response(200, status), new Error(privateMessage),
    response(200, status), response(200, receipt),
  ]);
  assert.deepEqual(await h.run(), receipt);
  assert.equal(h.waits.length, 2);
  assert.equal(h.tokenCount(), 2);
  assert.equal(h.messages.some((message) => message.includes(syntheticToken)), false);
});

test('identity errors and malformed tokens fail with fixed diagnostics', async () => {
  for (const getToken of [
    async () => { throw new Error('sensitive ' + syntheticToken); },
    async () => 'short', async () => syntheticToken + '\r\nInjected: header',
  ]) {
    const h = harness([response(200, status)], { getToken });
    await assert.rejects(h.run(), (error) => {
      assert.ok(error instanceof WebReleaseSyncError);
      assert.match(error.message, /WEB_SYNC_IDENTITY_(UNAVAILABLE|INVALID)/);
      assert.equal(error.message.includes(syntheticToken), false);
      return true;
    });
    assert.equal(h.requests.length, 1);
    assert.equal(h.waits.length, 0);
  }
});

test('twenty-minute deadline terminates repeated stale status without real waiting or bearer issuance', async () => {
  const count = WEB_SYNC_TIMEOUT_MS / WEB_SYNC_RETRY_MS;
  const h = harness(Array.from({ length: count }, () => response(200, { ...status, sourceCommit: previousCommit })));
  await assert.rejects(h.run(), /WEB_SYNC_TIMEOUT:WEB_DEPLOYMENT_PENDING/);
  assert.equal(h.time(), WEB_SYNC_TIMEOUT_MS);
  assert.equal(h.requests.length, count);
  assert.equal(h.tokenCount(), 0);
});

test('a request that consumes the remaining deadline cannot obtain identity or issue a POST', async () => {
  let h;
  h = harness([async () => { h.advance(WEB_SYNC_TIMEOUT_MS); return response(200, status); }]);
  await assert.rejects(h.run(), /WEB_SYNC_TIMEOUT/);
  assert.equal(h.requests.length, 1);
  assert.equal(h.tokenCount(), 0);
});
