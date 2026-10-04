import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../../server/app.ts";
import { ProductService } from "../../server/services/ProductService.ts";
afterEach(() => vi.restoreAllMocks());
describe("T14 montagem na aplicação", () => {
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "%s expõe somente a consulta pública sem sessão",
    async (prefix) => {
      vi.spyOn(ProductService, "listPublicProducts").mockResolvedValue([]);
      const result = await request(app).get(prefix + "/products");
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ products: [] });
      expect(result.headers["x-request-id"]).toBeTruthy();
      expect(
        (await request(app).get(prefix + "/producer/products")).status,
      ).toBe(401);
    },
  );
});
