import express from "express";
import request from "supertest";
import { it, expect, vi, afterEach } from "vitest";
vi.mock("../../server/middleware/adminSession.ts", () => ({
  adminSessionMiddleware: (req: any, _res: any, next: any) => {
    req.adminActor = {
      userId: "admin",
      role: "platform_admin",
      isSuperAdmin: false,
      sectors: req.headers["x-test-sector"]
        ? [req.headers["x-test-sector"]]
        : [],
    };
    next();
  },
}));
import {
  documentRouter,
  adminDocumentRouter,
} from "../../server/routes/documentRoutes";
import {
  DocumentStorageService,
  DocumentError,
} from "../../server/services/DocumentStorageService";
import { GeminiDocumentProcessor } from "../../server/services/GeminiDocumentProcessor";
const id = "11111111-1111-4111-8111-111111111111";
function app(role = "producer") {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.actor = role === "guest" ? null : { userId: id, roles: [role] };
    req.requestId = id;
    req.clientIpHash = "a".repeat(64);
    next();
  });
  a.use("/producer", documentRouter);
  a.use("/admin", adminDocumentRouter);
  return a;
}
afterEach(() => vi.restoreAllMocks());
it("rejeita usuário não autenticado", async () =>
  expect(
    (await request(app("guest")).get("/producer?propertyId=" + id)).status,
  ).toBe(401));
it("rejeita consumidor", async () =>
  expect(
    (await request(app("consumer")).get("/producer?propertyId=" + id)).status,
  ).toBe(403));
it("respeita portal ativo", async () =>
  expect(
    (
      await request(app())
        .get("/producer?propertyId=" + id)
        .set("Cookie", "hvm_portal_role=consumer")
    ).status,
  ).toBe(403));
it("rejeita UUID inválido antes de acessar serviço", async () => {
  const f = vi.spyOn(DocumentStorageService, "download");
  expect((await request(app()).get("/producer/bad/download")).status).toBe(422);
  expect(f).not.toHaveBeenCalled();
});
it("bloqueia POST cross origin", async () => {
  const f = vi.spyOn(DocumentStorageService, "confirm");
  expect(
    (
      await request(app())
        .post("/producer/" + id + "/confirm")
        .set("Origin", "https://attacker.example")
        .send({ commandId: id })
    ).status,
  ).toBe(403);
  expect(f).not.toHaveBeenCalled();
});
it("não revela documento de outro proprietário", async () => {
  vi.spyOn(DocumentStorageService, "download").mockRejectedValue(
    new DocumentError("DOCUMENT_NOT_FOUND", 404),
  );
  expect(
    (await request(app()).get("/producer/" + id + "/download")).status,
  ).toBe(404);
});
it("entrega o arquivo autenticado na origem", async () => {
  vi.spyOn(DocumentStorageService, "file").mockResolvedValue({
    bytes: Buffer.from("%PDF-1.7"),
    mimeType: "application/pdf",
    fileName: "car.pdf",
  });
  const r = await request(app()).get("/producer/" + id + "/file");
  expect(r.status).toBe(200);
  expect(r.headers["content-type"]).toMatch(/pdf/);
  expect(r.headers["content-disposition"]).toMatch(/inline/);
  expect(r.body.toString()).toContain("%PDF");
});
it("não libera quarentena", async () => {
  vi.spyOn(DocumentStorageService, "download").mockRejectedValue(
    new DocumentError("DOCUMENT_NOT_AVAILABLE"),
  );
  expect(
    (await request(app()).get("/producer/" + id + "/download")).status,
  ).toBe(409);
});
it("setor não autorizado não lê documentos", async () => {
  const f = vi.spyOn(DocumentStorageService, "list");
  expect(
    (
      await request(app())
        .get("/admin?propertyId=" + id)
        .set("x-test-sector", "catalog_moderation")
    ).status,
  ).toBe(403);
  expect(f).not.toHaveBeenCalled();
});
it("setor documental pode ler", async () => {
  vi.spyOn(DocumentStorageService, "list").mockResolvedValue([]);
  expect(
    (
      await request(app())
        .get("/admin?propertyId=" + id)
        .set("x-test-sector", "document_verification")
    ).status,
  ).toBe(200);
});
it("admin não ganha endpoint de extração mutacional", async () =>
  expect(
    (
      await request(app())
        .post("/admin/" + id + "/extraction")
        .set("Sec-Fetch-Site", "same-origin")
        .set("x-test-sector", "document_verification")
        .send({ commandId: id })
    ).status,
  ).toBe(404));
it("produtor declara os dados do documento", async () => {
  const f = vi.spyOn(DocumentStorageService, "declare").mockResolvedValue({
    propertyUpdated: true,
    areaApplied: true,
    propertyStatus: "completed",
    discrepancies: [],
  } as never);
  const r = await request(app())
    .post("/producer/" + id + "/declare")
    .set("Sec-Fetch-Site", "same-origin")
    .send({
      commandId: id,
      propertyRegisteredName: "Sítio Boa Vista",
      municipality: "Ariquemes",
      totalAreaHectares: 12.5,
    });
  expect(r.status).toBe(200);
  expect(r.body.propertyUpdated).toBe(true);
  expect(f).toHaveBeenCalledOnce();
});
it("declaração sem nome é rejeitada", async () => {
  const f = vi.spyOn(DocumentStorageService, "declare");
  expect(
    (
      await request(app())
        .post("/producer/" + id + "/declare")
        .set("Sec-Fetch-Site", "same-origin")
        .send({ commandId: id })
    ).status,
  ).toBe(422);
  expect(f).not.toHaveBeenCalled();
});
it("admin não declara dados no lugar do produtor", async () => {
  const f = vi.spyOn(DocumentStorageService, "declare");
  expect(
    (
      await request(app())
        .post("/admin/" + id + "/declare")
        .set("Sec-Fetch-Site", "same-origin")
        .set("x-test-sector", "document_verification")
        .send({
          commandId: id,
          propertyRegisteredName: "Sítio",
          municipality: "Ariquemes",
          totalAreaHectares: 10,
        })
    ).status,
  ).toBe(404);
  expect(f).not.toHaveBeenCalled();
});
it("contrato exige commandId", async () => {
  const f = vi.spyOn(GeminiDocumentProcessor, "process");
  expect(
    (
      await request(app())
        .post("/producer/" + id + "/extraction")
        .set("Sec-Fetch-Site", "same-origin")
        .send({})
    ).status,
  ).toBe(422);
  expect(f).not.toHaveBeenCalled();
});
