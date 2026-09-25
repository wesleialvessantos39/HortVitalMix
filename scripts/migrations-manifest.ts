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

const remoteVersionAliases: Readonly<Record<string, string>> = {
  // A migration de hardening T05 foi aplicada em produção com timestamp gerado
  // pelo Supabase. O conteúdo/nome são canônicos; somente a versão física difere.
  "20260923022554": "20260923022000",
  // A migration de credencial administrativa T05 foi aplicada pelo Supabase
  // com timestamp físico próprio; conteúdo e nome permanecem canônicos.
  "20260924023250": "20260924023000",
  // Confirmação explícita do e-mail administrativo aplicada pelo Supabase
  // com timestamp físico próprio.
  "20260924115207": "20260924114500",
  // Revogação de sessões do recovery aplicada com timestamp físico Supabase.
  "20260924124802": "20260924125000",
  // Trilha 06 aplicada pelo Supabase com timestamp físico próprio.
  "20260925002406": "20260925002000",
  // Hardening RLS T06 aplicado pelo Supabase com timestamp físico próprio.
  "20260925002930": "20260925003500",
  // Homologação/hardening T06 aplicada pelo Supabase com timestamp físico próprio.
  "20260925010313": "20260925010000",
  // Correção de normalização do fingerprint T06 aplicada com timestamp físico próprio.
  "20260925010505": "20260925011000",
};

export function validateHistory(rows: { version: string; name: string }[]) {
  if (
    rows.length !== manifest.migrations.length ||
    rows.some((row, index) => {
      const expected = manifest.migrations[index];
      const canonicalVersion = remoteVersionAliases[row.version] ?? row.version;
      return canonicalVersion !== expected.version || row.name !== expected.name;
    })
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
