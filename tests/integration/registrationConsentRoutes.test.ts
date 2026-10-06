import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  record: vi.fn(),
  register: vi.fn(),
  actorId: null as string | null,
}));
vi.mock("../../server/config/runtime.ts", async (original) => {
  const actual = await original<typeof import("../../server/config/runtime.ts")>();
  return { ...actual, runtime: { ...actual.runtime, serviceKey: "synthetic-consent-signing-key" } };
});
vi.mock("../../server/db/pool.ts", () => ({ dbPool: null }));
vi.mock("../../server/supabase/client.ts", () => ({
  supabaseAdmin: null,
  supabasePublic: null,
  createSupabasePublicClient: () => null,
  createSupabaseUserClient: () => null,
}));
vi.mock("../../server/services/AuthService.ts", () => ({
  register: m.register,
  recordLgpdCadastroAcceptance: m.record,
}));
import { authRouter } from "../../server/routes/authRoutes.ts";
import { issueRegistrationConsentProof } from "../../server/security/registrationConsent.ts";
import { issueConfirmationContext } from "../../server/security/confirmationContext.ts";

const input = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "synthetic@example.test",
  policyVersion: "lgpd-cadastro-2026-10-02",
};
function app() {
  const server = express();
  server.use(express.json());
  server.use((req, res, next) => {
    req.actor = m.actorId
      ? {
          userId: m.actorId,
          roles: ["consumer"],
          personId: null,
          fullName: null,
          email: input.email,
        }
      : null;
    req.clientIpHash = "a".repeat(64);
    res.locals.requestId = "audit-consent";
    next();
  });
  server.use("/v1/auth", authRouter);
  return server;
}
beforeEach(() => {
  vi.resetAllMocks();
  m.actorId = null;
  m.record.mockResolvedValue({ status: "recorded" });
});
describe("Integridade do aceite de cadastro", () => {
  it("não registra aceite apenas por conhecer UUID e e-mail", async () => {
    const response = await request(app())
      .post("/v1/auth/lgpd-acceptance")
      .send(input);
    expect(m.record).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
  });
  it("mantém o aceite do titular com sessão já validada", async () => {
    m.actorId = input.userId;
    const response = await request(app())
      .post("/v1/auth/lgpd-acceptance")
      .send(input);
    expect(response.status).toBe(204);
    expect(m.record).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ userId: input.userId, email: input.email }),
    );
  });
  it("uma sessão de outro titular não autoriza o aceite", async () => {
    m.actorId = "22222222-2222-4222-8222-222222222222";
    const response = await request(app())
      .post("/v1/auth/lgpd-acceptance")
      .send(input);
    expect(response.status).toBe(401);
    expect(m.record).not.toHaveBeenCalled();
  });
  it("preserva a contingência anônima com prova do cadastro, sem autenticar a conta", async () => {
    const consentProof = issueRegistrationConsentProof(input);
    const response = await request(app())
      .post("/v1/auth/lgpd-acceptance")
      .send({ ...input, consentProof });
    expect(response.status).toBe(204);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(m.record).toHaveBeenCalledOnce();
  });
  it.each(["uuid", "email", "expirada", "alterada", "confirmacao"])(
    "nega prova %s antes de registrar",
    async (scenario) => {
      let consentProof = issueRegistrationConsentProof(input);
      let body = { ...input, consentProof };
      if (scenario === "uuid")
        body.userId = "22222222-2222-4222-8222-222222222222";
      if (scenario === "email") body.email = "another@example.test";
      if (scenario === "expirada")
        body.consentProof = issueRegistrationConsentProof(
          input,
          Date.now() - 11 * 60_000,
        );
      if (scenario === "alterada")
        body.consentProof =
          consentProof.slice(0, -1) + (consentProof.endsWith("0") ? "1" : "0");
      if (scenario === "confirmacao")
        body.consentProof = issueConfirmationContext(input.userId, "consumer");
      const response = await request(app())
        .post("/v1/auth/lgpd-acceptance")
        .send(body);
      expect(response.status).toBe(401);
      expect(m.record).not.toHaveBeenCalled();
    },
  );
  it("mantém erro controlado quando o registro não pode ser persistido", async () => {
    m.actorId = input.userId;
    m.record.mockResolvedValue({ status: "unavailable" });
    const response = await request(app())
      .post("/v1/auth/lgpd-acceptance")
      .send(input);
    expect(response.status).toBe(503);
    expect(response.body.error).toBe("DATABASE_UNAVAILABLE");
  });
  it.each([
    { role: "platform_super_admin" },
    { consentProof: "x".repeat(2049) },
  ])("recusa campos privilegiados e prova sem limite", async (extra) => {
    const response = await request(app())
      .post("/v1/auth/lgpd-acceptance")
      .send({ ...input, ...extra });
    expect(response.status).toBe(422);
    expect(m.record).not.toHaveBeenCalled();
  });
});
