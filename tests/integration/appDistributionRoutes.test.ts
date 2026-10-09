import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminActorContext } from "../../server/middleware/adminSession.ts";

vi.mock("../../server/middleware/adminSession.ts", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../../server/middleware/adminSession.ts")
    >();
  return {
    ...original,
    adminSessionMiddleware: (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      // HTTP fixtures supply a verified actor. Production session verification is
      // exercised by the existing session-security suites, not faked via tokens.
      if (!req.adminActor) {
        res.status(401).json({ error: "UNAUTHORIZED" });
        return;
      }
      next();
    },
  };
});
import {
  appDistributionRouter,
  appDownloadRouter,
} from "../../server/routes/appDistributionRoutes.ts";
import {
  AppDistributionError,
  AppDistributionService,
} from "../../server/services/AppDistributionService.ts";
import { CommerceError } from "../../server/services/CommerceSupport.ts";
import { app as realApp } from "../../server/app.ts";
import vercelHandler from "../../server/vercelHandler.ts";

const apk =
  "https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/public/app-downloads/android/1.0.0/hvm.apk";
const actor = (
  changes: Partial<AdminActorContext> = {},
): AdminActorContext => ({
  userId: randomUUID(),
  role: "platform_super_admin",
  sectors: [],
  deniedSectors: [],
  isSuperAdmin: true,
  sessionIssuedAt: new Date().toISOString(),
  ...changes,
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
  for (const prefix of ["/v1", "/api/v1", "/_hvm_api/v1"])
    instance.use(prefix, appDistributionRouter);
  instance.use("/downloads", appDownloadRouter);
  return instance;
}
const input = () => ({
  commandId: randomUUID(),
  expectedRevision: 1,
  payload: {
    android: { version: "1.0.0", url: apk },
    ios: null,
    releaseNotes: "Versão disponível.",
  },
});
const origin = (test: request.Test) =>
  test.set("Sec-Fetch-Site", "same-origin");
afterEach(() => vi.restoreAllMocks());

describe("HTTP de distribuição: sessão, setor, confirmação e downloads sem redirects arbitrários", () => {
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "protege montagem real da leitura e escrita administrativa em %s",
    async (prefix) => {
      expect(
        (await request(realApp).get(prefix + "/admin/app-distribution")).status,
      ).toBe(401);
      expect(
        (
          await origin(
            request(realApp).patch(prefix + "/admin/app-distribution"),
          ).send(input())
        ).status,
      ).toBe(401);
    },
  );
  it("dispatcher Vercel exige sessão no endpoint administrativo", async () => {
    const response = await request(vercelHandler).get(
      "/api?__hvm_path=v1/admin/app-distribution",
    );
    expect(response.status).toBe(401);
    expect(response.headers["content-type"]).toContain("application/json");
  });
  it("admin sem departamento e Super com negação não consultam dados", async () => {
    const read = vi.spyOn(AppDistributionService, "getAdmin"),
      update = vi.spyOn(AppDistributionService, "update");
    for (const restricted of [
      actor({
        role: "platform_admin",
        isSuperAdmin: false,
        sectors: ["finance_ops"],
      }),
      actor({ deniedSectors: ["platform_configuration"] }),
    ]) {
      expect(
        (await request(app(restricted)).get("/v1/admin/app-distribution"))
          .status,
      ).toBe(403);
      expect(
        (
          await origin(
            request(app(restricted)).patch("/v1/admin/app-distribution"),
          ).send(input())
        ).status,
      ).toBe(403);
    }
    expect(read).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it("confirmação recente é exigida antes de validar/gravar e informa o mesmo ator", async () => {
    const admin = actor({
      sessionIssuedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    });
    const update = vi.spyOn(AppDistributionService, "update");
    const response = await origin(
      request(app(admin)).patch("/v1/admin/app-distribution"),
    ).send(input());
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      error: "ADMIN_REAUTHENTICATION_REQUIRED",
      actorId: admin.userId,
    });
    expect(update).not.toHaveBeenCalled();
  });
  it("origem cruzada nunca altera links mesmo com ator autorizado", async () => {
    const update = vi.spyOn(AppDistributionService, "update");
    const response = await request(app(actor()))
      .patch("/v1/admin/app-distribution")
      .set("Sec-Fetch-Site", "cross-site")
      .set("Origin", "https://attacker.invalid")
      .send(input());
    expect(response.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });
  it("URL não confiável e campos adicionais recebem422 antes da mutação", async () => {
    const update = vi.spyOn(AppDistributionService, "update");
    const valid = input();
    for (const forged of [
      {
        ...valid,
        payload: {
          ...valid.payload,
          android: {
            version: "1.0.0",
            url: "https://attacker.invalid/app.apk",
          },
        },
      },
      {
        ...valid,
        payload: {
          ...valid.payload,
          ios: { version: "1.0.0", url: "https://attacker.invalid/app.ipa" },
        },
      },
      { ...valid, actorId: randomUUID() },
    ]) {
      const response = await origin(
        request(app(actor())).patch("/v1/admin/app-distribution"),
      ).send(forged);
      expect(response.status).toBe(422);
      expect(response.body.error).toBe("VALIDATION_FAILED");
    }
    expect(update).not.toHaveBeenCalled();
  });
  it("admin delegado grava pela identidade verificada e retorna revisão da mutação", async () => {
    const admin = actor({
      role: "platform_admin",
      isSuperAdmin: false,
      sectors: ["platform_configuration"],
    });
    const update = vi
      .spyOn(AppDistributionService, "update")
      .mockResolvedValue({
        status: "success",
        revision: 2,
        auditEventId: randomUUID(),
      });
    const valid = input();
    const response = await origin(
      request(app(admin)).patch("/v1/admin/app-distribution"),
    ).send(valid);
    expect(response.status).toBe(200);
    expect(response.body.revision).toBe(2);
    expect(update).toHaveBeenCalledWith(valid, admin, {
      requestId: expect.any(String),
      ipHash: "a".repeat(64),
    });
    expect(response.headers["cache-control"]).toContain("no-store");
  });
  it("conflito preserva a revisão atual e revogação canônica permanece403", async () => {
    vi.spyOn(AppDistributionService, "update").mockRejectedValue(
      new AppDistributionError("DISTRIBUTION_REVISION_CONFLICT", 409, 7),
    );
    const response = await origin(
      request(app(actor())).patch("/v1/admin/app-distribution"),
    ).send(input());
    expect(response.status).toBe(409);
    expect(response.body.currentRevision).toBe(7);
    vi.spyOn(AppDistributionService, "getAdmin").mockRejectedValue(
      new CommerceError("FORBIDDEN", 403),
    );
    expect(
      (await request(app(actor())).get("/v1/admin/app-distribution")).status,
    ).toBe(403);
  });
  it("links estáveis e API usam o destino configurado atual, ignorando URL da query", async () => {
    const download = vi
      .spyOn(AppDistributionService, "getDownload")
      .mockResolvedValue(apk);
    for (const path of [
      "/downloads/android",
      "/v1/app-distribution/download/android",
      "/api/v1/app-distribution/download/android",
      "/_hvm_api/v1/app-distribution/download/android",
    ]) {
      const response = await request(app()).get(
        path + "?url=https://attacker.invalid&next=https://attacker.invalid",
      );
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(apk);
      expect(response.headers["cache-control"]).toContain("no-store");
    }
    expect(download).toHaveBeenCalledWith("android");
  });
  it("ausência de artefato não fabrica download e plataforma desconhecida não consulta banco", async () => {
    const download = vi
      .spyOn(AppDistributionService, "getDownload")
      .mockResolvedValue(null);
    const unavailable = await request(app()).get("/downloads/ios");
    expect(unavailable.status).toBe(404);
    expect(unavailable.headers.location).toBeUndefined();
    expect(unavailable.body).toEqual({
      error: "APP_DOWNLOAD_NOT_AVAILABLE",
      applicationsPath: "/aplicativos",
    });
    download.mockClear();
    expect((await request(app()).get("/downloads/windows")).status).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });
  it("/downloads montado no app real e dispatcher Vercel preservam resolução e JSON", async () => {
    vi.spyOn(AppDistributionService, "getDownload").mockResolvedValue(apk);
    expect(
      (await request(realApp).get("/downloads/android")).headers.location,
    ).toBe(apk);
    const rewritten = await request(vercelHandler).get(
      "/api?__hvm_path=v1/app-distribution/download/android",
    );
    expect(rewritten.status).toBe(302);
    expect(rewritten.headers.location).toBe(apk);
    vi.spyOn(AppDistributionService, "getDownload").mockResolvedValue(null);
    const missing = await request(vercelHandler).get(
      "/api?__hvm_path=v1/app-distribution/download/ios",
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("APP_DOWNLOAD_NOT_AVAILABLE");
  });
  it("dependência indisponível não redireciona nem expõe detalhes internos", async () => {
    vi.spyOn(AppDistributionService, "getDownload").mockRejectedValue(
      new Error("private connection credential"),
    );
    const response = await request(app()).get("/downloads/android");
    expect(response.status).toBe(503);
    expect(response.headers.location).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain(
      "private connection credential",
    );
  });
});
