import { readFile } from 'node:fs/promises';
export function certificateDigest(proof, expected) {
  const fingerprints = [...proof.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]+)$/gm)];
  const pinned = String(expected).replace(/:/g, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(pinned) || fingerprints.length !== 1 || fingerprints[0][1].toLowerCase() !== pinned) throw new Error('ANDROID_SIGNER_PIN_MISMATCH');
  return pinned;
}
if (process.argv[1]?.endsWith('/cert-proof.mjs')) {
  try { process.stdout.write(certificateDigest(await readFile(process.argv[2], 'utf8'), process.env.HVM_ANDROID_CERTIFICATE_SHA256) + '\n'); }
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
