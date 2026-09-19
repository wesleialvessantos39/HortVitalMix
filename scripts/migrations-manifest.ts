import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import manifest from "../supabase/manifest.json" with { type: "json" };
export function migrationHash() {
  const root = join(process.cwd(), "supabase/migrations");
  const files = readdirSync(root)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (
    JSON.stringify(files) !==
    JSON.stringify(manifest.migrations.map((m) => m.file))
  )
    throw new Error("MIGRATION_MANIFEST_MISMATCH");
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file + "\n");
    hash.update(readFileSync(join(root, file)));
    hash.update("\n");
  }
  return hash.digest("hex");
}
export function validateHistory(rows: { version: string; name: string }[]) {
  if (
    rows.length !== manifest.migrations.length ||
    rows.some(
      (r, i) =>
        r.version !== manifest.migrations[i].version ||
        r.name !== manifest.migrations[i].name,
    )
  )
    throw new Error("REMOTE_MIGRATION_HISTORY_MISMATCH");
  return manifest.schemaVersion;
}
if (import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(
    JSON.stringify({
      schemaVersion: manifest.schemaVersion,
      hash: migrationHash(),
    }),
  );
