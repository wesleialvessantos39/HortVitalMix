import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../../server/app.ts";
import vercelHandler from "../../server/vercelHandler.ts";
describe("T16 montagem real e cotação interna", () => {
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "protege configuração em %s",
    async (prefix) => {
      expect(
        (await request(app).get(prefix + "/producer/store/delivery")).status,
      ).toBe(401);
      expect(
        (
          await request(app)
            .post(prefix + "/delivery/quotes")
            .set("Sec-Fetch-Site", "same-origin")
        ).status,
      ).toBe(404);
    },
  );
  it("dispatcher Vercel conserva autenticação", async () => {
    const r = await request(vercelHandler).get(
      "/api?__hvm_path=v1/producer/store/delivery&path=v1%2Fproducer%2Fstore%2Fdelivery",
    );
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("AUTH_REQUIRED");
  });
});
