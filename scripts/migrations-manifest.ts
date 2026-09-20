import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import manifest from "../supabase/manifest.json" with { type: "json" };

export function hashMigrationContents(
  entries: ReadonlyArray<readonly [string, string | Buffer]>,
) {
  const hash = createHash("sha256");
  for (const [file, content] of entries) {
    hash.update(file + "\n");
    hash.update(content);
    hash.update("\n");
  }
  return hash.digest("hex");
}

export function migrationHash() {
  const root = join(process.cwd(), "supabase/migrations");
  const files = readdirSync(root)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  if (
    JSON.stringify(files) !==
    JSON.stringify(manifest.migrations.map((migration) => migration.file))
  )
    throw new Error("MIGRATION_MANIFEST_MISMATCH");

  return hashMigrationContents(
    files.map((file) => [file, readFileSync(join(root, file))] as const),
  );
}

export function assertManifestHash() {
  const actual = migrationHash();
  if (actual !== manifest.migrationHistoryHash)
    throw new Error("MIGRATION_HASH_MANIFEST_MISMATCH");
  return actual;
}

export function validateHistory(rows: { version: string; name: string }[]) {
  if (
    rows.length !== manifest.migrations.length ||
    rows.some(
      (row, index) =>
        row.version !== manifest.migrations[index].version ||
        row.name !== manifest.migrations[index].name,
    )
  )
    throw new Error("REMOTE_MIGRATION_HISTORY_MISMATCH");

  return manifest.schemaVersion;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(
    JSON.stringify({
      schemaVersion: manifest.schemaVersion,
      hash: assertManifestHash(),
    }),
  );
