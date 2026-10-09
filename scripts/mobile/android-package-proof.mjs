import { readFile } from 'node:fs/promises';
export function verifyAndroidPackage(proof, expected) {
  const match = /^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m.exec(proof);
  if (!match || match[1] !== expected.appId || match[2] !== String(expected.buildNumber) || match[3] !== expected.version) throw new Error('ANDROID_PACKAGE_IDENTITY_MISMATCH');
  return true;
}
if (process.argv[1]?.endsWith('/android-package-proof.mjs')) {
  try {
    const metadata = JSON.parse(await readFile('packaging/capacitor/native-build.json','utf8'));
    verifyAndroidPackage(await readFile(process.argv[2],'utf8'), metadata);
  } catch(error) { process.stderr.write(error.message+'\n'); process.exitCode=1; }
}
