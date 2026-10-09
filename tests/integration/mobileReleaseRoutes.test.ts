import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminActorContext } from "../../server/middleware/adminSession.ts";
vi.mock("../../server/middleware/adminSession.ts", async (original) => {
  const actual =
    await original<typeof import("../../server/middleware/adminSession.ts")>();
  return {
    ...actual,
    adminSessionMiddleware: (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (!req.adminActor) {
        res.status(401).json({ error: "UNAUTHORIZED" });
        return;
      }
      next();
    },
  };
});
vi.mock("../../server/security/mobileCiIdentity.ts", async (original) => {
  const actual =
    await original<
      typeof import("../../server/security/mobileCiIdentity.ts")
    >();
  return { ...actual, verifyMobileCiToken: vi.fn() };
});
import {
  mobileReleaseRouter,
  mobileCiRouter,
} from "../../server/routes/mobileReleaseRoutes.ts";
import {
  MobileReleaseService,
  MobileReleaseError,
} from "../../server/services/MobileReleaseService.ts";
import {
  verifyMobileCiToken,
  MobileCiIdentityError,
} from "../../server/security/mobileCiIdentity.ts";
import { app as realApp } from "../../server/app.ts";
import vercelHandler from "../../server/vercelHandler.ts";
const actor = (change: Partial<AdminActorContext> = {}): AdminActorContext => ({
  userId: randomUUID(),
  role: "platform_super_admin",
  isSuperAdmin: true,
  sectors: [],
  deniedSectors: [],
  sessionIssuedAt: new Date().toISOString(),
  ...change,
});
function app(admin?: AdminActorContext) {
  const instance = express();
  instance.use(express.json());
  instance.use((req, _res, next) => {
    req.adminActor = admin;
    req.requestId = randomUUID();
    req.clientIpHash = "a".repeat(64);
    next();
  });
  for (const prefix of ["/v1", "/api/v1", "/_hvm_api/v1"]) {
    instance.use(prefix, mobileCiRouter);
    instance.use(prefix, mobileReleaseRouter);
  }
  return instance;
}
const command = () => ({
  commandId: randomUUID(),
  expectedRevision: 1,
  action: "configure",
  autoPublish: { android: true, ios: false },
});
const origin = (test: request.Test) =>
  test.set("Sec-Fetch-Site", "same-origin");
afterEach(() => vi.restoreAllMocks());
describe("HTTP do centro de atualizações mobile", () => {
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "montagem real em %s bloqueia endpoints sem sessão",
    async (prefix) => {
      expect(
        (await request(realApp).get(prefix + "/admin/mobile-releases")).status,
      ).toBe(401);
      expect(
        (
          await origin(
            request(realApp).post(prefix + "/admin/mobile-releases/commands"),
          ).send(command())
        ).status,
      ).toBe(401);
    },
  );
  it("dispatcher Vercel resolve ledger administrativo protegido", async () => {
    const response = await request(vercelHandler).get(
      "/api?__hvm_path=v1/admin/mobile-releases",
    );
    expect(response.status).toBe(401);
    expect(response.headers["content-type"]).toContain("application/json");
  });
  it("nega setor ausente e deny no Super antes de consultar ledger", async () => {
    const read = vi.spyOn(MobileReleaseService, "getAdmin"),
      write = vi.spyOn(MobileReleaseService, "command");
    for (const denied of [
      actor({
        role: "platform_admin",
        isSuperAdmin: false,
        sectors: ["finance_ops"],
      }),
      actor({ deniedSectors: ["platform_configuration"] }),
    ]) {
      expect(
        (await request(app(denied)).get("/v1/admin/mobile-releases")).status,
      ).toBe(403);
      expect(
        (
          await origin(
            request(app(denied)).post("/v1/admin/mobile-releases/commands"),
          ).send(command())
        ).status,
      ).toBe(403);
    }
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
  it("exige confirmação recente e ator de reautenticação exato", async () => {
    const admin = actor({
      sessionIssuedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    });
    const write = vi.spyOn(MobileReleaseService, "command");
    const response = await origin(
      request(app(admin)).post("/v1/admin/mobile-releases/commands"),
    ).send(command());
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      error: "ADMIN_REAUTHENTICATION_REQUIRED",
      actorId: admin.userId,
    });
    expect(write).not.toHaveBeenCalled();
  });
  it("bloqueia origem cruzada e campos/payload indevidos", async () => {
    const write = vi.spyOn(MobileReleaseService, "command");
    expect(
      (
        await request(app(actor()))
          .post("/v1/admin/mobile-releases/commands")
          .set("Origin", "https://attacker.invalid")
          .set("Sec-Fetch-Site", "cross-site")
          .send(command())
      ).status,
    ).toBe(403);
    expect(
      (
        await origin(
          request(app(actor())).post("/v1/admin/mobile-releases/commands"),
        ).send({ ...command(), actorId: randomUUID() })
      ).status,
    ).toBe(422);
    expect(write).not.toHaveBeenCalled();
  });
  it("CAS fornece revisão atual sem detalhes privados e sucesso é no-store", async () => {
    const write = vi
      .spyOn(MobileReleaseService, "command")
      .mockRejectedValueOnce(
        new MobileReleaseError("MOBILE_RELEASE_REVISION_CONFLICT", 409, 7),
      )
      .mockResolvedValueOnce({ status: "success", revision: 8 });
    const conflict = await origin(
      request(app(actor())).post("/v1/admin/mobile-releases/commands"),
    ).send(command());
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ currentRevision: 7 });
    const success = await origin(
      request(app(actor())).post("/v1/admin/mobile-releases/commands"),
    ).send(command());
    expect(success.status).toBe(200);
    expect(success.headers["cache-control"]).toContain("no-store");
    expect(write).toHaveBeenCalledTimes(2);
  });
  it("CI sem token confiável não chama Storage nem publicação", async () => {
    vi.mocked(verifyMobileCiToken).mockRejectedValue(
      new MobileCiIdentityError(),
    );
    const prepare = vi.spyOn(MobileReleaseService, "prepareUpload"),
      accept = vi.spyOn(MobileReleaseService, "acceptCi");
    for (const path of ["uploads", "releases"]) {
      const response = await request(app())
        .post("/v1/mobile-ci/" + path)
        .send({});
      expect(response.status).toBe(401);
      expect(response.body.error).toBe("MOBILE_CI_UNAUTHORIZED");
    }
    expect(prepare).not.toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
  });
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "CI em montagem real %s usa OIDC antes da sessão Supabase",
    async (prefix) => {
      const identity = {
        sourceCommit: "a".repeat(40),
        runId: "12345",
        runAttempt: 1,
      };
      vi.mocked(verifyMobileCiToken).mockResolvedValue(identity);
      const prepare = vi
        .spyOn(MobileReleaseService, "prepareUpload")
        .mockResolvedValue({
          path: "android/1/a.apk",
          signedUploadUrl: "https://example.invalid/signed",
          token: "synthetic",
          url: "https://example.invalid/a.apk",
          expiresAt: new Date().toISOString(),
        });
      const input = {
        platform: "android",
        buildNumber: 1,
        sha256: "a".repeat(64),
        sizeBytes: 200,
      };
      const response = await request(realApp)
        .post(prefix + "/mobile-ci/uploads")
        .set("Origin", "http://localhost:3000")
        .set("Authorization", "Bearer synthetic-github-oidc")
        .send(input);
      expect(response.status).toBe(200);
      expect(prepare).toHaveBeenCalledWith(input, identity);
      expect(vi.mocked(verifyMobileCiToken)).toHaveBeenCalledWith(
        "synthetic-github-oidc",
      );
    },
  );
  it("CI autenticado usa identidade verificada, não a fornecida no corpo", async () => {
    const identity = {
      sourceCommit: "a".repeat(40),
      runId: "12345",
      runAttempt: 1,
    };
    vi.mocked(verifyMobileCiToken).mockResolvedValue(identity);
    const prepare = vi
      .spyOn(MobileReleaseService, "prepareUpload")
      .mockResolvedValue({
        path: "android/1/a.apk",
        signedUploadUrl: "https://example.invalid/signed",
        token: "synthetic",
        url: "https://example.invalid/a.apk",
        expiresAt: new Date().toISOString(),
      });
    const input = {
      platform: "android",
      buildNumber: 1,
      sha256: "a".repeat(64),
      sizeBytes: 200,
    };
    const response = await request(app())
      .post("/v1/mobile-ci/uploads")
      .set("Authorization", "Bearer synthetic-oidc")
      .send(input);
    expect(response.status).toBe(200);
    expect(prepare).toHaveBeenCalledWith(input, identity);
    expect(
      (
        await request(app())
          .post("/v1/mobile-ci/uploads")
          .set("Authorization", "Bearer synthetic-oidc")
          .send({ ...input, runId: "another" })
      ).status,
    ).toBe(422);
  });
  it("erro interno vira503 e não revela conexão/chaves do provedor", async () => {
    vi.spyOn(MobileReleaseService, "getPublic").mockRejectedValue(
      new Error("postgres://private-user:secret@private-host"),
    );
    const response = await request(app()).get("/v1/mobile-releases");
    expect(response.status).toBe(503);
    expect(response.body.error).toBe("MOBILE_RELEASES_UNAVAILABLE");
    expect(JSON.stringify(response.body)).not.toContain("secret");
  });
});
