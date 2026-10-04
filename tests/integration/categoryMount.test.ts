import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../../server/app.ts";
import { CategoryService } from "../../server/services/CategoryService.ts";
afterEach(() => vi.restoreAllMocks());
describe("T13 rotas montadas na aplicação real", () => {
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "%s alcança catálogo público e guarda administrativo",
    async (prefix) => {
      vi.spyOn(CategoryService, "listActiveCategories").mockResolvedValue([]);
      const publicResponse = await request(app).get(prefix + "/categories");
      expect(publicResponse.status).toBe(200);
      expect(publicResponse.body).toEqual({ categories: [] });
      const protectedResponse = await request(app).get(
        prefix + "/admin/categories",
      );
      expect(protectedResponse.status).toBe(401);
      expect(protectedResponse.body.error).not.toBe("NOT_FOUND");
    },
  );
});
