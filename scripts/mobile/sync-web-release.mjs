import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { oidcToken } from './publish-release.mjs';

export const WEB_RELEASE_ORIGIN = 'https://hortvitalmix.vercel.app';
export const WEB_RELEASE_STATUS_URL = `${WEB_RELEASE_ORIGIN}/api/v1/mobile-ci/web-release/status`;
export const WEB_RELEASE_SYNC_URL = `${WEB_RELEASE_ORIGIN}/api/v1/mobile-ci/web-release`;
export const WEB_SYNC_TIMEOUT_MS = 20 * 60_000;
export const WEB_SYNC_RETRY_MS = 15_000;
export const WEB_SYNC_CALL_TIMEOUT_MS = 15_000;
const buildManifest = JSON.parse(readFileSync(new URL('../../supabase/manifest.json', import.meta.url), 'utf8'));
const commitPattern = /^[a-f0-9]{40}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const releasePattern = /^[a-z0-9][a-z0-9_.-]{2,63}$/;
const transientPostErrors = new Set(['WEB_CANONICAL_STATUS_UNAVAILABLE', 'WEB_RELEASE_UNAVAILABLE']);
const fatalPostErrors = new Set([
  'WEB_RELEASE_CHANGED', 'WEB_CI_RUN_NOT_NEWER', 'WEB_RELEASE_ALREADY_ARCHIVED',
  'WEB_SCHEMA_MISMATCH', 'WEB_MIGRATION_HISTORY_MISMATCH',
]);

/** Messages contain only our own diagnostic codes, never response bodies or tokens. */
export class WebReleaseSyncError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}:${detail}` : code);
    this.name = 'WebReleaseSyncError';
    this.code = code;
  }
}

function strictObject(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function validIdentity(value) {
  return typeof value.sourceCommit === 'string' && commitPattern.test(value.sourceCommit)
    && Number.isSafeInteger(value.schemaVersion) && value.schemaVersion > 0
    && typeof value.migrationHistoryHash === 'string' && hashPattern.test(value.migrationHistoryHash);
}

function statusIdentity(value) {
  if (!strictObject(value, ['appEnv', 'sourceCommit', 'schemaVersion', 'migrationHistoryHash'])
    || value.appEnv !== 'production' || !validIdentity(value)) {
    throw new WebReleaseSyncError('WEB_SYNC_STATUS_INVALID');
  }
  return value;
}

function confirmedReceipt(value, sourceCommit, expected) {
  if (!strictObject(value, ['status', 'releaseTag', 'sourceCommit', 'schemaVersion', 'migrationHistoryHash'])
    || !['synced', 'idempotent'].includes(value.status)
    || typeof value.releaseTag !== 'string' || !releasePattern.test(value.releaseTag)
    || !validIdentity(value) || value.sourceCommit !== sourceCommit
    || value.schemaVersion !== expected.schemaVersion
    || value.migrationHistoryHash !== expected.migrationHistoryHash) {
    throw new WebReleaseSyncError('WEB_SYNC_RECEIPT_INVALID');
  }
  return value;
}

/** Injected dependencies keep tests entirely local and avoid real waiting or publication. */
export async function syncWebRelease({
  env = process.env,
  fetch: request = globalThis.fetch,
  now = () => performance.now(),
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  getToken = oidcToken,
  manifest = buildManifest,
  log = (message) => process.stdout.write(`${message}\n`),
} = {}) {
  const sourceCommit = env.GITHUB_SHA;
  if (env.GITHUB_REF !== 'refs/heads/main'
    || !['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)
    || typeof sourceCommit !== 'string' || !commitPattern.test(sourceCommit)) {
    throw new WebReleaseSyncError('WEB_SYNC_EVENT_REJECTED');
  }
  if (!Number.isSafeInteger(manifest.schemaVersion) || manifest.schemaVersion < 1
    || typeof manifest.migrationHistoryHash !== 'string' || !hashPattern.test(manifest.migrationHistoryHash)) {
    throw new WebReleaseSyncError('WEB_SYNC_BUILD_MANIFEST_INVALID');
  }
  const expected = { schemaVersion: manifest.schemaVersion, migrationHistoryHash: manifest.migrationHistoryHash };
  const deadline = now() + WEB_SYNC_TIMEOUT_MS;
  let attempt = 0, lastDiagnostic = 'WEB_DEPLOYMENT_PENDING';

  function remainingBudget() {
    const remaining = deadline - now();
    if (remaining <= 0) throw new WebReleaseSyncError('WEB_SYNC_TIMEOUT', lastDiagnostic);
    return Math.max(1, Math.min(WEB_SYNC_CALL_TIMEOUT_MS, Math.floor(remaining)));
  }

  async function bounded(operation) {
    const milliseconds = remainingBudget();
    let timer;
    try {
      return await Promise.race([
        operation(AbortSignal.timeout(milliseconds)),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new WebReleaseSyncError('WEB_SYNC_CALL_UNAVAILABLE')), milliseconds);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function responseJson(response, invalidCode) {
    try { return await response.json(); }
    catch { throw new WebReleaseSyncError(invalidCode); }
  }

  async function pause(diagnostic) {
    lastDiagnostic = diagnostic;
    log(`Web release ${sourceCommit.slice(0, 7)} awaiting synchronization: ${diagnostic}.`);
    const remaining = deadline - now();
    if (remaining <= 0) throw new WebReleaseSyncError('WEB_SYNC_TIMEOUT', diagnostic);
    await delay(Math.min(WEB_SYNC_RETRY_MS, remaining));
  }

  while (true) {
    remainingBudget();
    attempt += 1;
    let statusResponse;
    try {
      statusResponse = await bounded(async (signal) => {
        const url = new URL(WEB_RELEASE_STATUS_URL);
        url.searchParams.set('check', `${attempt}-${Math.floor(now())}`);
        return await request(url.href, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal });
      });
    } catch {
      await pause('WEB_SYNC_STATUS_UNAVAILABLE');
      continue;
    }
    if (statusResponse.redirected || (statusResponse.status >= 300 && statusResponse.status < 400)) {
      throw new WebReleaseSyncError('WEB_SYNC_STATUS_REDIRECT_REJECTED');
    }
    if ([401, 404].includes(statusResponse.status) || statusResponse.status >= 500) {
      await pause(`WEB_SYNC_STATUS_HTTP_${statusResponse.status}`);
      continue;
    }
    if (statusResponse.status !== 200) throw new WebReleaseSyncError('WEB_SYNC_STATUS_HTTP_REJECTED');
    const published = statusIdentity(await bounded(() => responseJson(statusResponse, 'WEB_SYNC_STATUS_INVALID')));
    if (published.sourceCommit !== sourceCommit) {
      await pause('WEB_DEPLOYMENT_PENDING');
      continue;
    }
    if (published.schemaVersion !== expected.schemaVersion || published.migrationHistoryHash !== expected.migrationHistoryHash) {
      throw new WebReleaseSyncError('WEB_SYNC_STATUS_MANIFEST_MISMATCH');
    }

    let token;
    try { token = await bounded(() => getToken()); }
    catch { throw new WebReleaseSyncError('WEB_SYNC_IDENTITY_UNAVAILABLE'); }
    if (typeof token !== 'string' || !/^[A-Za-z0-9_.-]{100,20000}$/.test(token)) {
      throw new WebReleaseSyncError('WEB_SYNC_IDENTITY_INVALID');
    }
    let syncedResponse;
    try {
      syncedResponse = await bounded((signal) => request(WEB_RELEASE_SYNC_URL, {
        method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${token}`, Origin: WEB_RELEASE_ORIGIN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceCommit }),
      }));
    } catch {
      await pause('WEB_SYNC_POST_UNAVAILABLE');
      continue;
    }
    if (syncedResponse.redirected || (syncedResponse.status >= 300 && syncedResponse.status < 400)) {
      throw new WebReleaseSyncError('WEB_SYNC_POST_REDIRECT_REJECTED');
    }
    if ([401, 403].includes(syncedResponse.status)) throw new WebReleaseSyncError('WEB_SYNC_IDENTITY_REJECTED');
    if (syncedResponse.status === 409 || syncedResponse.status === 503) {
      const errorBody = await bounded(() => responseJson(syncedResponse, 'WEB_SYNC_POST_INVALID'));
      const code = errorBody && typeof errorBody === 'object' ? errorBody.error : undefined;
      if (syncedResponse.status === 409 && code === 'WEB_DEPLOYMENT_PENDING') {
        await pause(code);
        continue;
      }
      if (syncedResponse.status === 503 && transientPostErrors.has(code)) {
        await pause(code);
        continue;
      }
      if (fatalPostErrors.has(code)) throw new WebReleaseSyncError(code);
      throw new WebReleaseSyncError('WEB_SYNC_POST_HTTP_REJECTED');
    }
    if (syncedResponse.status !== 200) throw new WebReleaseSyncError('WEB_SYNC_POST_HTTP_REJECTED');
    const receipt = confirmedReceipt(await bounded(() => responseJson(syncedResponse, 'WEB_SYNC_RECEIPT_INVALID')), sourceCommit, expected);
    log(`Web release ${sourceCommit.slice(0, 7)}: ${receipt.status}; schema ${receipt.schemaVersion}.`);
    return receipt;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  syncWebRelease().catch((error) => {
    process.stderr.write(`${error instanceof WebReleaseSyncError ? error.message : 'WEB_SYNC_FAILED'}\n`);
    process.exitCode = 1;
  });
}
