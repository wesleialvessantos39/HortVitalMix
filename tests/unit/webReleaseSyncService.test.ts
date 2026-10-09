import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import manifest from "../../supabase/manifest.json";
const state = vi.hoisted(() => ({
  runtime: { appEnv: "production", commitSha: "b".repeat(40) },
  connect: vi.fn(),
}));
vi.mock("../../server/config/runtime.ts", () => ({ runtime: state.runtime }));
vi.mock("../../server/db/pool.ts", () => ({ dbPool: { connect: state.connect } }));
import { WebReleaseSyncService as service, probeCanonicalWebRuntime } from "../../server/services/WebReleaseSyncService.ts";
const identity = (change = {}) => ({ sourceCommit: "b".repeat(40), runId: "9002", runAttempt: 1, ...change });
const input = (sha = "b".repeat(40)) => ({ sourceCommit: sha });
const current = (change = {}) => ({ id: "old", release_tag: "test-previous", commit_sha: "a".repeat(40), schema_version: manifest.schemaVersion, migration_history_hash: manifest.migrationHistoryHash, ...change });
let query: ReturnType<typeof vi.fn>, release: ReturnType<typeof vi.fn>;
function database(options: {
  observed?: unknown; locked?: unknown; history?: unknown[]; highWater?: string | null; archived?: boolean;
} = {}) {
  let reads = 0;
  query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.startsWith("SELECT id,release_tag")) return { rows: [(++reads === 1 ? options.observed : options.locked) ?? current()], rowCount: 1 };
    if (sql.includes("supabase_migrations.schema_migrations")) return { rows: options.history ?? manifest.migrations.map(({ version, name }) => ({ version, name })) };
    if (sql.includes("AS run_id")) return { rows: [{ run_id: options.highWater ?? null }] };
    if (sql.startsWith("SELECT 1 FROM public.app_releases")) return { rows: [], rowCount: options.archived ? 1 : 0 };
    if (sql.startsWith("INSERT INTO")) return { rows: [current({ id: "new", release_tag: params![0], commit_sha: params![1] })] };
    return { rows: [] };
  });
  release = vi.fn();
  state.connect.mockResolvedValue({ query, release });
}
beforeEach(() => {
  state.connect.mockReset();
  state.runtime.appEnv = "production";
  state.runtime.commitSha = "b".repeat(40);
  database();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    appEnv: "production", sourceCommit: state.runtime.commitSha,
    schemaVersion: manifest.schemaVersion, migrationHistoryHash: manifest.migrationHistoryHash,
  }))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("Sincronização autenticada da publicação web", () => {
  it.each([
    [{ sourceCommit: "a".repeat(40) }, identity(), "WEB_CI_COMMIT_MISMATCH"],
    [input(), identity({ sourceCommit: "c".repeat(40) }), "WEB_CI_COMMIT_MISMATCH"],
    [input(), identity({ runId: "invalid" }), "MOBILE_CI_UNAUTHORIZED"],
    [{ ...input(), schemaVersion: 999 }, identity(), "VALIDATION_FAILED"],
  ])("nega dados não vinculados ao OIDC sem abrir banco", async (body, actor, code) => {
    await expect(service.sync(body, actor)).rejects.toMatchObject({ code });
    expect(state.connect).not.toHaveBeenCalled();
  });
  it("recusa preview ou runtime que ainda atende SHA anterior sem banco", async () => {
    state.runtime.appEnv = "homologation";
    await expect(service.sync(input(), identity())).rejects.toMatchObject({ code: "WEB_PRODUCTION_REQUIRED" });
    state.runtime.appEnv = "production";
    state.runtime.commitSha = "a".repeat(40);
    await expect(service.sync(input(), identity())).rejects.toMatchObject({ code: "WEB_DEPLOYMENT_PENDING", status: 409 });
    expect(state.connect).not.toHaveBeenCalled();
  });
  it("valida todas migrations e aceita os aliases físicos conhecidos", async () => {
    const rows = manifest.migrations.map(({ version, name }) => ({ version, name }));
    rows[rows.length - 2].version = "20261009225521";
    rows[rows.length - 1].version = "20261009225532";
    database({ history: rows });
    expect((await service.sync(input(), identity())).status).toBe("synced");
    expect(query).toHaveBeenCalledWith("SELECT pg_advisory_xact_lock(hashtext('hvm-release-production'))");
  });
  it.each(["missing", "renamed", "extra"])("história %s não sela nem escreve DDL", async (caseName) => {
    const history = manifest.migrations.map(({ version, name }) => ({ version, name }));
    if (caseName === "missing") history.pop();
    if (caseName === "renamed") history[0].name = "altered";
    if (caseName === "extra") history.push({ version: "99999999999999", name: "extra" });
    database({ history });
    await expect(service.sync(input(), identity())).rejects.toMatchObject({ code: "WEB_MIGRATION_HISTORY_MISMATCH", status: 503 });
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(query.mock.calls.some(([sql]) => /^(UPDATE|INSERT|CREATE|ALTER|DELETE)/.test(sql))).toBe(false);
  });
  it.each([{ schema_version: 999 }, { migration_history_hash: "c".repeat(64) }])("recusa schema/hash divergente antes de gravar", async (change) => {
    database({ locked: current(change) });
    await expect(service.sync(input(), identity())).rejects.toMatchObject({ code: "WEB_SCHEMA_MISMATCH" });
    expect(query.mock.calls.some(([sql]) => /^(UPDATE|INSERT)/.test(sql))).toBe(false);
  });
  it("repetição da SHA atual é idempotente sem renovar tempo nem duplicar", async () => {
    database({ observed: current({ commit_sha: "b".repeat(40) }), locked: current({ commit_sha: "b".repeat(40) }) });
    expect(await service.sync(input(), identity())).toMatchObject({ status: "idempotent", releaseTag: "test-previous" });
    expect(query.mock.calls.some(([sql]) => /^(UPDATE|INSERT)/.test(sql))).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });
  it("sela somente app_releases com SHA/schema/hash e identidade autenticados", async () => {
    expect(await service.sync(input(), identity())).toMatchObject({ status: "synced", sourceCommit: "b".repeat(40), schemaVersion: 68, migrationHistoryHash: manifest.migrationHistoryHash });
    const writes = query.mock.calls.filter(([sql]) => /^(UPDATE|INSERT)/.test(sql));
    expect(writes).toHaveLength(2);
    expect(writes.every(([sql]) => sql.includes("public.app_releases"))).toBe(true);
    expect(writes[1][1]).toEqual(expect.arrayContaining(["auto-web-v68-bbbbbbbbbbbb", "github-actions:9002:1"]));
    expect(query).toHaveBeenCalledWith("COMMIT");
  });
  it("pedido que aguardou publicação mais recente falha CAS sem sobrescrever", async () => {
    database({ locked: current({ id: "newer", commit_sha: "c".repeat(40) }) });
    await expect(service.sync(input(), identity())).rejects.toMatchObject({ code: "WEB_RELEASE_CHANGED" });
    expect(query.mock.calls.some(([sql]) => /^(UPDATE|INSERT)/.test(sql))).toBe(false);
  });
  it.each(["9002", "9003", "123456789012345678901234567890"])("run antigo não ultrapassa high-water %s", async (highWater) => {
    database({ highWater });
    await expect(service.sync(input(), identity())).rejects.toMatchObject({ code: "WEB_CI_RUN_NOT_NEWER" });
    expect(query.mock.calls.some(([sql]) => /^(UPDATE|INSERT)/.test(sql))).toBe(false);
  });
  it("dispatch com ID novo não ressuscita uma SHA já arquivada", async () => {
    database({ archived: true });
    await expect(service.sync(input(), identity())).rejects.toMatchObject({ code: "WEB_RELEASE_ALREADY_ARCHIVED" });
    expect(query.mock.calls.some(([sql]) => /^(UPDATE|INSERT)/.test(sql))).toBe(false);
  });
  it("falha SQL faz rollback e não expõe o detalhe do banco", async () => {
    query.mockRejectedValueOnce(new Error("private connection details"));
    await expect(service.sync(input(), identity())).rejects.toMatchObject({ code: "WEB_RELEASE_UNAVAILABLE", status: 503 });
    expect(release).toHaveBeenCalledOnce();
  });
  it("Pooler indisponível usa código próprio transitório sem vazar conexão", async () => {
    state.connect.mockRejectedValueOnce(new Error("private credentials"));
    await expect(service.sync(input(), identity())).rejects.toMatchObject({ code: "WEB_RELEASE_UNAVAILABLE", status: 503 });
    expect(query).not.toHaveBeenCalled();
  });
  it("self-probe consulta somente host HTTPS fixo sem redirects e sem cache", async () => {
    await probeCanonicalWebRuntime();
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/hortvitalmix\.vercel\.app\/api\/v1\/mobile-ci\/web-release\/status\?nonce=[a-f0-9-]+$/);
    expect(options).toMatchObject({ redirect: "error", cache: "no-store", headers: { "Cache-Control": "no-cache" } });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });
  it("instância antiga não sela quando alias canônico atende uma SHA diferente", async () => {
    const probe = async () => ({ appEnv: "production" as const, sourceCommit: "c".repeat(40), schemaVersion: 68, migrationHistoryHash: manifest.migrationHistoryHash });
    await expect(service.sync(input(), identity(), { probe })).rejects.toMatchObject({ code: "WEB_DEPLOYMENT_PENDING" });
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(query.mock.calls.some(([sql]) => /^(UPDATE|INSERT)/.test(sql))).toBe(false);
  });
  it("canonical status falso, timeout, redirect ou hash divergente não modifica release", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("redirect refused"));
    await expect(service.sync(input(), identity())).rejects.toMatchObject({ code: "WEB_CANONICAL_STATUS_UNAVAILABLE", status: 503 });
    expect(query.mock.calls.some(([sql]) => /^(UPDATE|INSERT)/.test(sql))).toBe(false);
    const probe = async () => ({ appEnv: "production" as const, sourceCommit: "b".repeat(40), schemaVersion: 68, migrationHistoryHash: "f".repeat(64) });
    await expect(service.sync(input(), identity(), { probe })).rejects.toMatchObject({ code: "WEB_SCHEMA_MISMATCH" });
  });
});
