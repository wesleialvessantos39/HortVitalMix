import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../server/app";

describe("Trilha 02 — proteção de origem administrativa", () => {
  it("bloqueia Sec-Fetch-Site cross-site antes da autenticação", async () => {
    const response = await request(app)
      .patch("/v1/admin/configuration")
      .set("Sec-Fetch-Site", "cross-site")
      .send({
        expectedRevision: 1,
        commandId: "11111111-1111-4111-8111-111111111111",
        payload: { slogan: "Tentativa cross-site bloqueada" },
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("ORIGIN_REJECTED");
  });

  it("exige sessão administrativa quando a origem é válida", async () => {
    const response = await request(app)
      .patch("/v1/admin/configuration")
      .set("Origin", "http://localhost:3000")
      .set("Host", "localhost:3000")
      .send({
        expectedRevision: 1,
        commandId: "22222222-2222-4222-8222-222222222222",
        payload: { slogan: "Mutação autenticada obrigatória" },
      });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("UNAUTHORIZED");
  });
});
