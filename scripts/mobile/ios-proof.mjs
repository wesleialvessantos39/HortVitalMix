import { readFile } from 'node:fs/promises';
export function verifyIosIdentity(info, entitlements, proof, expected) {
  const team = /^TeamIdentifier=([A-Z0-9]{10})$/m.exec(proof)?.[1];
  if (!team || team !== expected.team || info.CFBundleIdentifier !== expected.appId || info.CFBundleShortVersionString !== expected.version || info.CFBundleVersion !== String(expected.buildNumber) || entitlements['com.apple.developer.team-identifier'] !== team || entitlements['application-identifier'] !== `${team}.${expected.appId}` || entitlements['get-task-allow'] !== false) throw new Error('IOS_SIGNING_PROOF_MISMATCH');
  return team;
}
if (process.argv[1]?.endsWith('/ios-proof.mjs')) {
  try {
    const metadata = JSON.parse(await readFile('packaging/capacitor/native-build.json','utf8'));
    const info = JSON.parse(await readFile(process.argv[2],'utf8'));
    const entitlements = JSON.parse(await readFile(process.argv[3],'utf8'));
    const proof = await readFile(process.argv[4],'utf8');
    process.stdout.write(verifyIosIdentity(info,entitlements,proof,{ ...metadata, team: process.env.HVM_APPLE_TEAM_ID })+'\n');
  } catch(error) { process.stderr.write(error.message+'\n'); process.exitCode=1; }
}
