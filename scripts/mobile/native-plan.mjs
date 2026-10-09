import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { classifyChanges } from './native-build.mjs';
const event = process.env.GITHUB_EVENT_NAME;
let required = event === 'workflow_dispatch';
if (!required) {
  const base = event === 'pull_request' ? process.env.HVM_PR_BASE_SHA : process.env.HVM_PUSH_BEFORE_SHA;
  if (!base || /^0+$/.test(base)) required = true;
  else {
    if (!/^[a-f0-9]{40}$/.test(base)) throw new Error('MOBILE_DIFF_BASE_INVALID');
    const files = execFileSync('git', ['diff', '--name-only', '-z', base, 'HEAD'], { encoding: 'utf8' }).split('\0').filter(Boolean);
    required = classifyChanges(files).nativeRequired;
  }
}
await appendFile(process.env.GITHUB_OUTPUT, `native_required=${required}\n`);
process.stdout.write(required ? 'Bundled web or native changes require Android/iOS verification builds.\n' : 'Server/data-only changes use the deployed backend without rebuilding native packages.\n');
