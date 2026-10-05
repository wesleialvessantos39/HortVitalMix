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
    throw new Error(
      "MIGRATION_HASH_MANIFEST_MISMATCH actual=" + actual +
      " expected=" + manifest.migrationHistoryHash,
    );
  return actual;
}

const remoteVersionAliases: Readonly<Record<string, string>> = {
  // Capas e carrosséis aplicados pelo Supabase com timestamp físico próprio.
  "20261005194858": "20261005191237",
  // Correção de cadastro/aceite aplicada com timestamp físico gerado pelo Supabase.
  "20261005152423": "20261005144950",
  // Descoberta/favoritos T17 aplicada com timestamp físico gerado pelo Supabase.
  "20261005134716": "20261005131647",
  // Área de entrega/frete T16 aplicada com timestamp físico gerado pelo Supabase.
  "20261005040640": "20261005034322",
  // Grants privilegiados T15 aplicados com timestamp físico gerado pelo Supabase.
  "20261005002434": "20261005002322",
  // Estoque/lotes T15 aplicado com timestamp físico gerado pelo Supabase.
  "20261005002132": "20261004235555",
  // Produtos/preços T14 aplicados com timestamp físico gerado pelo Supabase.
  "20261004210207": "20261004202124",
  // Taxonomia global T13 aplicada com timestamp físico gerado pelo Supabase.
  "20261004142901": "20261004133608",
  // Vitrine comercial T12 aplicada com timestamp físico gerado pelo Supabase.
  "20261004124506": "20261004120547",
  "20261004014120": "20261004013902",
  // Governança de imóveis/contas/localidades aplicada pelo Supabase em UTC.
  "20261004012409": "20261003151000",
  // Reconstrução controlada de localidades/onboarding aplicada pelo Supabase.
  "20261003030427": "20261003025010",
  // Sincronização canônica imóvel/auditoria aplicada com timestamp físico Supabase.
  "20260930184151": "20260930184100",
  // T12: hardening final da fila/arquivo aplicado com timestamp físico Supabase.
  "20260930173943": "20260930173900",
  // T12: retirada de imóvel aprovado aplicada em produção com timestamp físico Supabase.
  "20260930172140": "20260930013000",
  // T12: aliases de login administrativo + arquivo da auditoria.
  "20260930172239": "20260930172000",
  // T11 aplicada/reconciliada em produção com timestamps físicos do Supabase.
  "20260929213043": "20260929120000",
  "20260929213048": "20260929133000",
  "20260929213052": "20260929200000",
  "20260928060434": "20260928060300",
  "20260928111654": "20260928110512",
  "20260927203404": "20260927202711",
  "20260927144553": "20260927143315",
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
  // Múltiplos endereços T07 aplicada pelo Supabase com timestamp físico próprio.
  "20260925192227": "20260925153500",
  // Cadastro rural T08 aplicado pelo Supabase com timestamp físico próprio.
  "20260926223504": "20260926190000",
  // Revogação de privilégios herdados T07/T08.
  "20260926223741": "20260926223700",
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
