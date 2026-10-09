import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const nativeRoot = path.join(repositoryRoot, 'packaging/capacitor');
export const canonicalBackend = 'https://hortvitalmix.vercel.app';
const SHA = /^[a-f0-9]{40}$/;
export function backendOrigin(value = canonicalBackend) {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.hostname === 'localhost' || /^\d+(\.\d+){3}$/.test(parsed.hostname)) {
    throw new Error('NATIVE_BACKEND_ORIGIN_INVALID');
  }
  return parsed.origin;
}
export function validateVersion(build, version) {
  const number = Number(build);
  if (!Number.isSafeInteger(number) || number < 1 || number > 2147483647 || !/^[1-9]\d*$/.test(String(build))) throw new Error('NATIVE_BUILD_INVALID');
  if (!/^\d+\.\d+\.\d+$/.test(version) || version.length > 32) throw new Error('NATIVE_VERSION_INVALID');
  return { buildNumber: number, version };
}
export function classifyChanges(files) {
  const relevant = files.filter((name) => !name.startsWith('docs/') && !name.endsWith('.md'));
  return {
    nativeRequired: relevant.some((name) => /^(src\/|public\/|shared\/|packaging\/capacitor\/|scripts\/mobile\/|index\.html$|vite\.config\.ts$|package(-lock)?\.json$|\.github\/workflows\/hvm-mobile-build\.yml$)/.test(name)),
    reason: relevant.some((name) => name.startsWith('packaging/capacitor/')) ? 'native-runtime-changed' : 'bundled-web-or-build-changed',
  };
}
const skip = (relative) => relative.split('/').some((part) => ['node_modules', '.gradle', 'build', 'DerivedData', 'xcuserdata', 'Pods', 'output', 'capacitor-cordova-android-plugins', 'capacitor-cordova-ios-plugins'].includes(part)) ||
  relative === 'native-build.json' || relative.endsWith('.md') || relative.startsWith('android/app/src/main/assets/') || relative.startsWith('ios/App/App/public/') ||
  /(^|\/)(local\.properties|capacitor\.config\.json|config\.xml)$/.test(relative) && relative !== 'capacitor.config.json';
async function filesUnder(root, prefix = '') {
  const result = [];
  for (const item of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    if (skip(relative)) continue;
    if (item.isDirectory()) result.push(...await filesUnder(root, relative));
    else if (item.isFile()) result.push(relative);
  }
  return result.sort();
}
export function normalizeRuntimeFile(relative, bytes) {
  if (relative === 'android/app/build.gradle') return Buffer.from(bytes.toString().replace(/versionCode\s+\d+/g, 'versionCode 1').replace(/versionName\s+"[^"]+"/g, 'versionName "1.0.0"'));
  if (relative === 'ios/App/App.xcodeproj/project.pbxproj') return Buffer.from(bytes.toString().replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, 'CURRENT_PROJECT_VERSION = 1;').replace(/MARKETING_VERSION = [^;]+;/g, 'MARKETING_VERSION = 1.0.0;'));
  return bytes;
}
export async function fingerprint(root = nativeRoot) {
  const config = JSON.parse(await readFile(path.join(root, 'capacitor.config.json'), 'utf8'));
  if (config.appId !== 'br.com.hortivitalmix.app' || config.webDir !== '../../dist' || config.server?.url || config.server?.allowNavigation || config.server?.cleartext !== false || config.plugins?.CapacitorHttp?.enabled !== false || config.android?.allowMixedContent !== false) throw new Error('NATIVE_RUNTIME_CONFIGURATION_UNSAFE');
  const hash = createHash('sha256');
  for (const relative of await filesUnder(root)) {
    hash.update(`${relative}\0`).update(normalizeRuntimeFile(relative, await readFile(path.join(root, relative)))).update('\0');
  }
  return hash.digest('hex');
}
export async function prepare(build, version, root = repositoryRoot, sourceCommit = process.env.GITHUB_SHA) {
  const identity = validateVersion(build, version);
  if (!sourceCommit || !SHA.test(sourceCommit)) throw new Error('NATIVE_SOURCE_COMMIT_INVALID');
  const origin = backendOrigin(process.env.HVM_NATIVE_BACKEND_ORIGIN || canonicalBackend);
  const runtimeRoot = path.join(root, 'packaging/capacitor');
  const runtimeFingerprint = await fingerprint(runtimeRoot);
  const android = path.join(runtimeRoot, 'android/app/build.gradle');
  const gradle = await readFile(android, 'utf8');
  if ((gradle.match(/versionCode\s+\d+/g) || []).length !== 1 || (gradle.match(/versionName\s+"[^"]+"/g) || []).length !== 1) throw new Error('ANDROID_VERSION_TARGET_INVALID');
  const ios = path.join(runtimeRoot, 'ios/App/App.xcodeproj/project.pbxproj');
  const project = await readFile(ios, 'utf8');
  if ((project.match(/CURRENT_PROJECT_VERSION = [^;]+;/g) || []).length !== 2 || (project.match(/MARKETING_VERSION = [^;]+;/g) || []).length !== 2) throw new Error('IOS_VERSION_TARGET_INVALID');
  const foundation = await readFile(path.join(root, 'shared/contracts/foundation.ts'), 'utf8');
  const match = /SCHEMA_VERSION\s*=\s*(\d+)/.exec(foundation);
  if (!match) throw new Error('MOBILE_SCHEMA_VERSION_MISSING');
  await writeFile(android, gradle.replace(/versionCode\s+\d+/, `versionCode ${identity.buildNumber}`).replace(/versionName\s+"[^"]+"/, `versionName "${identity.version}"`));
  await writeFile(ios, project.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${identity.buildNumber};`).replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${identity.version};`));
  return { ...identity, appId: 'br.com.hortivitalmix.app', runtimeFingerprint, sourceCommit, schemaVersion: Number(match[1]), backendOrigin: origin, ota: 'unavailable' };
}
async function main() {
  const [command, build, version] = process.argv.slice(2);
  if (command === 'fingerprint') process.stdout.write(`${await fingerprint()}\n`);
  else if (command === 'prepare') {
    const metadata = await prepare(build, version);
    await writeFile(path.join(nativeRoot, 'native-build.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(metadata)}\n`);
  } else throw new Error('MOBILE_BUILD_COMMAND_INVALID');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
