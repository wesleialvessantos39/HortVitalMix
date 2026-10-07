import request from "supertest";
import { describe, it, expect } from "vitest";
import { app } from "../../server/app.ts";
const id = "00000000-0000-4000-8000-000000000024";
describe("T24 rotas e transporte", () => {
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "protege avaliações privadas/admin no prefixo %s",
    async (prefix) => {
      for (const path of [`/orders/${id}/review`, "/admin/reviews"]) {
        const r = await request(app).get(prefix + path);
        expect(r.status).toBe(401);
        expect(r.headers["cache-control"]).toContain("no-store");
      }
      expect(
        (
          await request(app)
            .post(prefix + "/reviews")
            .set("Sec-Fetch-Site", "same-origin")
            .send({ orderId: id, rating: 5 })
        ).status,
      ).toBe(401);
      expect(
        (
          await request(app)
            .post(prefix + `/admin/reviews/${id}/moderate`)
            .set("Sec-Fetch-Site", "same-origin")
            .send({ reason: "Motivo válido" })
        ).status,
      ).toBe(401);
    },
  );
  it("bloqueia mutação cross-origin antes do serviço", async () =>
    expect(
      (
        await request(app)
          .post("/api/v1/reviews")
          .set("Origin", "https://attacker.invalid")
          .send({ orderId: id, rating: 5 })
      ).status,
    ).toBe(403));
  it("valida slug e paginação pública antes de acessar o banco", async () => {
    for (const path of [
      "/stores/UPPER/reviews",
      "/stores/loja/reviews?page=0",
      "/stores/loja/reviews?state=moderated",
    ])
      expect((await request(app).get("/api/v1" + path)).status).toBe(422);
  });
});
