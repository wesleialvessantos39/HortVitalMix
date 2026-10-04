import { spawnSync } from "node:child_process";

// Vercel's loader does not support require(ESM), even when local Node does.
// Import the complete handler with that compatibility path disabled.
const result = spawnSync(process.execPath, [
  "--no-experimental-require-module", "--import", "tsx",
  "--input-type=module", "--eval",
  'await import("./api/index.ts"); process.exit(0);',
], { cwd: new URL("../", import.meta.url), stdio: "inherit", timeout: 30000 });

if (result.error || result.status !== 0) {
  console.error("API_COLD_START_FAILED");
  process.exit(result.status || 1);
}
console.log("API_COLD_START_OK_WITHOUT_REQUIRE_ESM");
