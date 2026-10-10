import { cpSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
mkdirSync(".pwa-test-builds", { recursive: true });
cpSync("dist", ".pwa-test-builds/a", { recursive: true });
execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--outDir", ".pwa-test-builds/b"], {
  // A synthetic commit belongs ONLY to this local test fixture. Resource IDs
  // and checksums still come from a real Vite compilation of changed assets.
  env: { ...process.env, VERCEL_GIT_COMMIT_SHA: "", HVM_BUILD_COMMIT_SHA: "b".repeat(40) }, stdio: "pipe",
});
console.log("Two local PWA builds prepared; no native package or remote data used.");
