import request from "supertest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../../server/app.ts";
import { ProductService } from "../../server/services/ProductService.ts";
import vercelHandler from "../../server/vercelHandler.ts";
afterEach(() => vi.restoreAllMocks());
describe("T14 montagem na aplicação", () => {
  it("usa a URL normalizada quando a Vercel mantém metadados em req.query", async () => {
    const list = vi
      .spyOn(ProductService, "listPublicProducts")
      .mockResolvedValue([]);
    const response = await request(
      (req: IncomingMessage, res: ServerResponse) => {
        Object.defineProperty(req, "query", {
          configurable: true,
          value: {
            __hvm_path: "v1/products",
            path: ["v1", "products"],
            search: "valor de metadado",
          },
        });
        void vercelHandler(req, res);
      },
    ).get("/api?__hvm_path=v1/products&path=v1%2Fproducts&search=couve");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ products: [] });
    expect(list).toHaveBeenCalledExactlyOnceWith({ search: "couve" });
    expect(
      (
        await request(vercelHandler).get(
          "/api?__hvm_path=v1/products&storeId=private",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(vercelHandler).get(
          "/api?__hvm_path=v1/products&search=a&search=b",
        )
      ).status,
    ).toBe(400);
  });
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
