import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backendOrigin, canonicalBackend, validateVersion } from './native-build.mjs';
export const audience = `${canonicalBackend}/mobile-ci`;
const storageOrigin = 'https://xipbsazvymkqqfmfegwu.supabase.co';
export function safeUploadUrl(value, expectedPath) {
  const url = new URL(value);
  if (url.origin !== storageOrigin || url.pathname !== `/storage/v1/object/upload/sign/app-downloads/${expectedPath}` || url.username || url.password || url.hash || !url.searchParams.get('token')) throw new Error('MOBILE_UPLOAD_DESTINATION_INVALID');
  return url.href;
}
export function validatePublication(metadata, bytes, identity, platform, officialUrl) {
  validateVersion(metadata.buildNumber, metadata.version);
  if (!/^[a-f0-9]{40}$/.test(metadata.sourceCommit) || metadata.sourceCommit !== process.env.GITHUB_SHA || !/^[a-f0-9]{64}$/.test(metadata.runtimeFingerprint) || !Number.isSafeInteger(metadata.schemaVersion) || metadata.schemaVersion < 1 || bytes.length < 100 || bytes.length > 150 * 1024 * 1024) throw new Error('MOBILE_RELEASE_PROOF_INVALID');
  if (platform === 'android' && !/^[a-f0-9]{64}$/.test(identity)) throw new Error('MOBILE_ANDROID_SIGNER_INVALID');
  if (platform === 'ios' && (!/^[A-Z0-9]{10}$/.test(identity) || !officialUrl || !/^https:\/\/(apps\.apple\.com\/[a-z]{2}\/app\/(?:[^/]+\/)?id\d+|testflight\.apple\.com\/join\/[A-Za-z0-9]+)$/.test(officialUrl))) throw new Error('MOBILE_APPLE_DISTRIBUTION_INVALID');
  const minimum = Number(process.env.HVM_MIN_SUPPORTED_BUILD || 1);
  if (!Number.isSafeInteger(minimum) || minimum < 1 || minimum > metadata.buildNumber) throw new Error('MOBILE_MINIMUM_BUILD_INVALID');
  return { platform, version: metadata.version, buildNumber: metadata.buildNumber, minSupportedBuild: minimum, runtimeFingerprint: metadata.runtimeFingerprint, sourceCommit: metadata.sourceCommit, schemaVersion: metadata.schemaVersion, sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length, channel: platform === 'android' ? 'apk' : officialUrl.startsWith('https://apps.apple.com/') ? 'app_store' : 'testflight', url: officialUrl || '', releaseNotes: String(process.env.HVM_RELEASE_NOTES || 'Melhorias e correções do HortiVitalMix.').trim().slice(0, 1600), signingIdentity: identity };
}
export async function oidcToken() {
  const tokenUrl = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL || '');
  if (tokenUrl.username || tokenUrl.password || tokenUrl.port || tokenUrl.hash || tokenUrl.protocol !== 'https:' || !tokenUrl.hostname.endsWith('.actions.githubusercontent.com') || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) throw new Error('MOBILE_CI_IDENTITY_UNAVAILABLE');
  tokenUrl.searchParams.set('audience', audience);
  const response = await fetch(tokenUrl, { headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('MOBILE_CI_IDENTITY_REJECTED');
  const body = await response.json();
  if (typeof body.value !== 'string' || body.value.length < 100) throw new Error('MOBILE_CI_IDENTITY_INVALID');
  return body.value;
}
export async function post(base, route, body, token) {
  const response = await fetch(`${base}/api/v1/mobile-ci/${route}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`MOBILE_CI_${route.toUpperCase()}_HTTP_${response.status}`);
  return await response.json();
}
async function main() {
  if (process.env.GITHUB_REF !== 'refs/heads/main' || !['push', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)) throw new Error('MOBILE_PUBLICATION_EVENT_REJECTED');
  const [platform, artifactFile, identityFile] = process.argv.slice(2);
  if (!['android', 'ios'].includes(platform)) throw new Error('MOBILE_PLATFORM_INVALID');
  const metadata = JSON.parse(await readFile('packaging/capacitor/native-build.json', 'utf8'));
  const bytes = await readFile(artifactFile);
  const identity = platform === 'android' ? (await readFile(identityFile, 'utf8')).trim() : process.env.HVM_APPLE_TEAM_ID;
  const publication = validatePublication(metadata, bytes, identity, platform, process.env.HVM_IOS_DISTRIBUTION_URL);
  const token = await oidcToken();
  const base = backendOrigin(process.env.HVM_MOBILE_CI_ORIGIN || canonicalBackend);
  if (platform === 'android') {
    const prepared = await post(base, 'uploads', { platform, buildNumber: publication.buildNumber, sha256: publication.sha256, sizeBytes: publication.sizeBytes }, token);
    const expectedPath = `android/${publication.buildNumber}/${publication.sha256}.apk`;
    if (prepared.path !== expectedPath || prepared.url !== `${storageOrigin}/storage/v1/object/public/app-downloads/${expectedPath}`) throw new Error('MOBILE_UPLOAD_RECEIPT_INVALID');
    const upload = await fetch(safeUploadUrl(prepared.signedUploadUrl, expectedPath), { method: 'PUT', headers: { 'Content-Type': 'application/vnd.android.package-archive', 'x-upsert': 'false' }, body: bytes, redirect: 'error', signal: AbortSignal.timeout(120000) });
    if (!upload.ok && upload.status !== 409) throw new Error(`MOBILE_ARTIFACT_UPLOAD_HTTP_${upload.status}`);
    publication.url = prepared.url;
  }
  const result = await post(base, 'releases', publication, await oidcToken());
  if (!['verified', 'published', 'idempotent_replay'].includes(result.status)) throw new Error('MOBILE_PUBLICATION_RECEIPT_INVALID');
  process.stdout.write(`Mobile release ${platform} ${publication.version}: ${result.status}.\n`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
