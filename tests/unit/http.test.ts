import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../../server/app";
import { dbPool } from "../../server/db/pool";
import {
  ApiHealthResponseSchema,
  ApiReadyResponseSchema,
} from "../../shared/contracts/foundation";
describe("API same-origin sem mocks", () => {
  it("liveness independente do banco com UUID", async () => {
    const r = await request(app).get("/health");
    expect(r.status).toBe(200);
    expect(ApiHealthResponseSchema.safeParse(r.body).success).toBe(true);
    expect(r.headers["x-request-id"]).toBe(r.body.requestId);
  });
  it.skipIf(Boolean(dbPool))(
    "readiness indisponível nunca responde 200",
    async () => {
      const r = await request(app).get("/ready");
      expect(r.status).toBe(503);
      expect(ApiReadyResponseSchema.safeParse(r.body).success).toBe(true);
      expect(r.body.databaseConnected).toBe(false);
    },
  );
  it("404 de API sempre é JSON", async () => {
    const r = await request(app).get("/missing");
    expect(r.status).toBe(404);
    expect(r.type).toMatch(/json/);
  });
  it("bloqueia origem externa antes de acessar Auth", async () => {
    const r = await request(app)
      .post("/v1/auth/login")
      .set("Origin", "https://attacker.example")
      .send({});
    expect(r.status).toBe(403);
  });
  it("aceita automaticamente a própria origem HTTPS publicada", async () => {
    const r = await request(app)
      .post("/v1/auth/login")
      .set("Origin", "https://hortivitalmix.vercel.app")
      .set("X-Forwarded-Host", "hortivitalmix.vercel.app")
      .set("X-Forwarded-Proto", "https")
      .send({});

    expect(r.status).toBe(400);
    expect(r.body.error).toBe("VALIDATION_ERROR");
  });

  it("cadastro inválido retorna os campos que precisam de correção", async () => {
    const r = await request(app)
      .post("/v1/auth/register-consumer")
      .set("Origin", "http://localhost:3000")
      .send({});

    expect(r.status).toBe(400);
    expect(r.body.error).toBe("VALIDATION_ERROR");
    expect(r.body.fields.map((item: { field: string }) => item.field)).toEqual(
      expect.arrayContaining(["fullName", "cpf", "email", "password", "phone"]),
    );
  });
  it("bloqueia mutação sem Origin", async () =>
    expect((await request(app).post("/v1/auth/logout")).status).toBe(403));
  it("rejeita JSON inválido com resposta estruturada", async () => {
    const r = await request(app)
      .post("/v1/auth/login")
      .set("Origin", "http://localhost:3000")
      .set("Content-Type", "application/json")
      .send("{");
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("INVALID_JSON");
  });
  it("não oferece cadastro público administrativo", async () => {
    const r = await request(app)
      .post("/v1/auth/register-admin")
      .set("Origin", "http://localhost:3000")
      .send({});
    expect(r.status).toBe(404);
  });
  it("sessão ausente não produz identidade inventada", async () =>
    expect((await request(app).get("/v1/auth/session")).status).toBe(401));
  it.each([
    "/v1/auth/resend-confirmation",
    "/v1/auth/request-password-reset",
    "/v1/auth/magic-link",
  ])("não dispara e-mail com entrada inválida em %s", async (path) => {
    const response = await request(app)
      .post(path)
      .set("Origin", "http://localhost:3000")
      .send({ email: "invalido" });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("VALIDATION_ERROR");
  });
  it("importação de sessão rejeita tokens inválidos antes de dependências", async () => {
    const response = await request(app)
      .post("/v1/auth/import-session")
      .set("Origin", "http://localhost:3000")
      .send({ accessToken: "x", refreshToken: "y" });
    expect(response.status).toBe(400);
  });
  it("reauth exige sessão real", async () => {
    const response = await request(app)
      .post("/v1/auth/reauthenticate")
      .set("Origin", "http://localhost:3000")
      .send({});
    expect(response.status).toBe(401);
  });
  it("redefinição exige sessão real mesmo com senha válida", async () => {
    const response = await request(app)
      .post("/v1/auth/reset-password")
      .set("Origin", "http://localhost:3000")
      .send({ password: "SenhaNovaMuitoForte!2026" });
    expect(response.status).toBe(401);
  });
  it("backend rejeita senha fraca antes de consultar sessão", async () => {
    const response = await request(app)
      .post("/v1/auth/reset-password")
      .set("Origin", "http://localhost:3000")
      .send({ password: "senhasemcriterios" });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("VALIDATION_ERROR");
  });
});
