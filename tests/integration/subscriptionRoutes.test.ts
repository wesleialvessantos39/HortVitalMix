import request from "supertest";
import { describe, it, expect } from "vitest";
import { app } from "../../server/app.ts";
const id = "00000000-0000-4000-8000-000000000023";
describe("T23 rotas privadas e transporte", () => {
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "sessão obrigatória em %s",
    async (prefix) => {
      for (const path of ["/subscriptions", "/producer/trial"]) {
        const r = await request(app).get(prefix + path);
        expect(r.status).toBe(401);
        expect(r.headers["cache-control"]).toContain("no-store");
      }
      for (const path of [
        "/subscriptions",
        ...["pause", "resume", "cancel", "billing"].map(
          (a) => `/subscriptions/${id}/${a}`,
        ),
      ])
        expect(
          (
            await request(app)
              .post(prefix + path)
              .set("Sec-Fetch-Site", "same-origin")
              .send({})
          ).status,
        ).toBe(401);
      expect(
        (await request(app).get(prefix + "/admin/subscription-plans")).status,
      ).toBe(401);
    },
  );
  it("origem externa bloqueada antes de mutação", async () => {
    expect(
      (
        await request(app)
          .post(`/api/v1/subscriptions/${id}/billing`)
          .set("Origin", "https://attacker.invalid")
          .send({})
      ).status,
    ).toBe(403);
  });
  it("contratos públicos rejeitam público e loja inválidos", async () => {
    expect(
      (await request(app).get("/api/v1/subscription-plans?audience=admin"))
        .status,
    ).toBe(422);
    expect(
      (await request(app).get("/api/v1/subscription-options/invalid")).status,
    ).toBe(422);
  });
});
