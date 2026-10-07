import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../../server/app.ts";
const id = "00000000-0000-4000-8000-000000000022";
describe("T22 rotas protegidas", () => {
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "sem sessão não consulta nem grava em %s",
    async (prefix) => {
      for (const path of [
        "/producer/delivery-windows",
        `/orders/${id}/delivery`,
      ]) {
        const res = await request(app).get(prefix + path);
        expect(res.status).toBe(401);
        expect(res.headers["cache-control"]).toContain("no-store");
      }
      for (const path of [
        "/producer/delivery-windows",
        `/producer/orders/${id}/delivery-allocation`,
        `/producer/orders/${id}/delivery-proof`,
      ])
        expect(
          (
            await request(app)
              .post(prefix + path)
              .set("Sec-Fetch-Site", "same-origin")
              .send({})
          ).status,
        ).toBe(401);
    },
  );
  it("origem externa não pode registrar prova", async () =>
    expect(
      (
        await request(app)
          .post(`/api/v1/producer/orders/${id}/delivery-proof`)
          .set("Origin", "https://attacker.invalid")
          .send({})
      ).status,
    ).toBe(403));
});
