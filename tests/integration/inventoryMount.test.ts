import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../../server/app.ts";
import vercelHandler from "../../server/vercelHandler.ts";
const id = "22222222-2222-4222-8222-222222222222";
describe("T15 montagem real e ausência de checkout", () => {
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "protege lotes na aplicação em %s",
    async (prefix) => {
      const result = await request(app).get(
        `${prefix}/producer/products/${id}/lots`,
      );
      expect(result.status).toBe(401);
      expect(result.headers["x-request-id"]).toBeTruthy();
      expect(
        (
          await request(app)
            .post(`${prefix}/inventory/reserve`)
            .set("Sec-Fetch-Site", "same-origin")
        ).status,
      ).toBe(404);
      expect(
        (
          await request(app)
            .post(`${prefix}/inventory/consume`)
            .set("Sec-Fetch-Site", "same-origin")
        ).status,
      ).toBe(404);
    },
  );
  it("dispatcher Vercel mantém proteção da rota", async () => {
    const result = await request(vercelHandler).get(
      `/api?__hvm_path=v1/producer/products/${id}/lots&path=v1%2Fproducer%2Fproducts&lotsPage=2`,
    );
    expect(result.status).toBe(401);
    expect(result.body.error).toBe("AUTH_REQUIRED");
  });
});
