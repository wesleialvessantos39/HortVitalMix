import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const expectedCases = new Map([
  ["tests/unit/configSchema.test.ts", 9],
  ["tests/unit/redactPII.test.ts", 4],
  ["tests/integration/configConcurrency.test.ts", 2],
  ["tests/integration/configIdempotency.test.ts", 3],
  ["tests/integration/configAudit.test.ts", 3],
  ["tests/integration/configReauth.test.ts", 3],
  ["tests/integration/configRls.test.ts", 3],
  ["tests/integration/configMaliciousPayload.test.ts", 4],
]);

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function assertIncludes(path, needles) {
  const source = read(path);
  for (const needle of needles) {
    if (!source.includes(needle)) {
      throw new Error(`T02_EVIDENCE_MISSING: ${path} -> ${needle}`);
    }
  }
}

let totalCases = 0;
for (const [path, expected] of expectedCases) {
  const source = read(path);
  const count = (source.match(/\b(?:it|test|integrationIt)\s*\(/g) ?? []).length;
  if (count !== expected) {
    throw new Error(`T02_CASE_COUNT_MISMATCH: ${path} expected=${expected} actual=${count}`);
  }
  totalCases += count;
}

if (totalCases !== 31) throw new Error(`T02_TOTAL_CASES_MISMATCH: ${totalCases}`);

assertIncludes("server/services/ConfigurationService.ts", [
  "BEGIN ISOLATION LEVEL SERIALIZABLE",
  "pg_advisory_xact_lock",
  "input.commandId",
  "expectedRevision",
  "redactPII",
  "INSERT INTO public.app_audit_events",
  "assertRecentAuth",
]);

assertIncludes("server/routes/adminConfigRoutes.ts", [
  "originProtection",
  "adminSessionMiddleware",
  "UpdateGlobalConfigSchema",
  "ConfigErrorCode.CONFLICT",
  "ConfigErrorCode.REAUTH_REQUIRED",
]);

assertIncludes("server/security/originProtection.ts", [
  'fetchSite === "cross-site"',
  'runtime.appEnv === "production"',
]);

assertIncludes("src/pages/admin/config/AdminConfiguracaoPage.tsx", [
  'state.status === "loading"',
  'state.status === "error"',
  'state.status === "empty"',
  'outcome.kind === "conflict"',
  'outcome.kind === "success"',
  'outcome.kind === "reauth_required"',
]);

assertIncludes("supabase/migrations/20260921193244_trilha02_config_hardening.sql", [
  "updated_by",
  "uq_app_audit_events_command_id",
  "ix_app_audit_events_config_target",
]);

const manifest = JSON.parse(read("supabase/manifest.json"));
if (manifest.schemaVersion !== 14) throw new Error("T02_SCHEMA_VERSION_MISMATCH");
if (
  manifest.migrationHistoryHash !==
  "4df210ea6d4cdb05280f33889280edb1411532b0f24f5da8f7044110ef2617dc"
) {
  throw new Error("T02_MIGRATION_HASH_MISMATCH");
}
if (
  !manifest.migrations.some(
    (m) =>
      m.version === "20260921193244" &&
      m.name === "trilha02_config_hardening",
  )
) {
  throw new Error("T02_MIGRATION_NOT_IN_MANIFEST");
}

console.log(
  JSON.stringify({
    status: "pass",
    trail: "02",
    cases: totalCases,
    schemaVersion: manifest.schemaVersion,
    migrationHistoryHash: manifest.migrationHistoryHash,
  }),
);
