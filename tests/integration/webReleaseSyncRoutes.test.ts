import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../server/security/mobileCiIdentity.ts", async (original) => ({
  ...await original<typeof import("../../server/security/mobileCiIdentity.ts")>(),
  verifyMobileCiToken: vi.fn(),
}));
import { verifyMobileCiToken, MobileCiIdentityError } from "../../server/security/mobileCiIdentity.ts";
import { WebReleaseSyncService, WebReleaseSyncError } from "../../server/services/WebReleaseSyncService.ts";
import { mobileCiRouter } from "../../server/routes/mobileReleaseRoutes.ts";
import { app as realApp } from "../../server/app.ts";
const sha = "b".repeat(40);
const identity = { sourceCommit: sha, runId: "9002", runAttempt: 1 };
const output = { status: "synced" as const, releaseTag: "auto-web-v68-bbbbbbbbbbbb", sourceCommit: sha, schemaVersion: 68, migrationHistoryHash: "a".repeat(64) };
const canonical = (test: request.Test) => test.set("Host", "hortvitalmix.vercel.app").set("Origin", "https://hortvitalmix.vercel.app");
function standalone() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.requestId = randomUUID(); next(); });
  app.use("/v1", mobileCiRouter);
  return app;
}
afterEach(() => vi.restoreAllMocks());
describe("Callback web de CI antes da autenticação Supabase", () => {
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])("montagem real %s autentica antes de DML", async (prefix) => {
    vi.mocked(verifyMobileCiToken).mockRejectedValue(new MobileCiIdentityError());
    const write = vi.spyOn(WebReleaseSyncService, "sync");
    const response = await canonical(request(realApp).post(prefix + "/mobile-ci/web-release")).send({ sourceCommit: sha });
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("MOBILE_CI_UNAUTHORIZED");
    expect(write).not.toHaveBeenCalled();
  });
  it("origem inválida é bloqueada antes de autenticar ou escrever", async () => {
    const write = vi.spyOn(WebReleaseSyncService, "sync");
    vi.mocked(verifyMobileCiToken).mockClear();
    const response = await request(realApp).post("/api/v1/mobile-ci/web-release").set("Origin", "https://attacker.invalid").send({ sourceCommit: sha });
    expect(response.status).toBe(403);
    expect(write).not.toHaveBeenCalled();
    expect(verifyMobileCiToken).not.toHaveBeenCalled();
  });
  it("payload estrito rejeita esquema, hash, SQL ou origem enviados pelo cliente", async () => {
    vi.mocked(verifyMobileCiToken).mockResolvedValue(identity);
    const write = vi.spyOn(WebReleaseSyncService, "sync");
    for (const extra of [{ schemaVersion: 999 }, { migrationHistoryHash: "c".repeat(64) }, { sql: "SELECT 1" }, { origin: "https://attacker.invalid" }]) {
      const response = await canonical(request(standalone()).post("/v1/mobile-ci/web-release")).set("Authorization", "Bearer trusted-fixture").send({ sourceCommit: sha, ...extra });
      expect(response.status).toBe(422);
    }
    expect(write).not.toHaveBeenCalled();
  });
  it("sucesso não cria sessão e resposta nunca fica em cache", async () => {
    vi.mocked(verifyMobileCiToken).mockResolvedValue(identity);
    const write = vi.spyOn(WebReleaseSyncService, "sync").mockResolvedValue(output);
    const response = await canonical(request(standalone()).post("/v1/mobile-ci/web-release")).set("Authorization", "Bearer trusted-fixture").send({ sourceCommit: sha });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.body).toEqual(output);
    expect(write).toHaveBeenCalledWith({ sourceCommit: sha }, identity);
  });
  it("SHA ainda não implantada retorna409 para retry sem detalhes privados", async () => {
    vi.mocked(verifyMobileCiToken).mockResolvedValue(identity);
    vi.spyOn(WebReleaseSyncService, "sync").mockRejectedValue(new WebReleaseSyncError("WEB_DEPLOYMENT_PENDING"));
    const response = await canonical(request(standalone()).post("/v1/mobile-ci/web-release")).set("Authorization", "Bearer trusted-fixture").send({ sourceCommit: sha });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("WEB_DEPLOYMENT_PENDING");
  });
  it("Host de preview ou Origin ausente não podem selar nem com token válido", async () => {
    vi.mocked(verifyMobileCiToken).mockClear();
    const write = vi.spyOn(WebReleaseSyncService, "sync");
    for (const config of [{ host: "old-deployment.vercel.app", origin: "https://hortvitalmix.vercel.app" }, { host: "hortvitalmix.vercel.app", origin: "" }]) {
      const response = await request(standalone()).post("/v1/mobile-ci/web-release").set("Host", config.host).set("Origin", config.origin).set("Authorization", "Bearer trusted-fixture").send({ sourceCommit: sha });
      expect(response.status).toBe(403);
    }
    expect(write).not.toHaveBeenCalled();
    expect(verifyMobileCiToken).not.toHaveBeenCalled();
  });
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])("status %s funciona sem Auth/SQL e nunca cria cookies", async (prefix) => {
    const write = vi.spyOn(WebReleaseSyncService, "sync");
    const response = await request(realApp).get(prefix + "/mobile-ci/web-release/status");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ appEnv: expect.any(String), sourceCommit: expect.any(String), schemaVersion: 68, migrationHistoryHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(write).not.toHaveBeenCalled();
  });
});
