import request from "supertest";
import { describe, expect, it, vi, afterEach } from "vitest";
import { app } from "../../server/app.ts";
import vercelHandler from "../../server/vercelHandler.ts";
import { DiscoveryService } from "../../server/services/DiscoveryService.ts";
afterEach(() => vi.restoreAllMocks());
describe("T17 montagem sem alterar o dispatcher anterior", () => {
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "busca e favoritos montados em %s",
    async (prefix) => {
      vi.spyOn(DiscoveryService, "searchStores").mockResolvedValue({
        stores: [],
        page: 1,
        pageSize: 20,
        hasMore: false,
        distanceReference: "ariquemes",
      });
      expect(
        (await request(app).get(prefix + "/discovery/stores")).status,
      ).toBe(200);
      expect((await request(app).get(prefix + "/favorites")).status).toBe(401);
    },
  );
  it("dispatcher normaliza metadados sem abrir favoritos privados", async () => {
    const result = await request(vercelHandler).get(
      "/api?__hvm_path=v1/favorites&path=v1%2Ffavorites",
    );
    expect(result.status).toBe(401);
    expect(result.body.error).toBe("AUTH_REQUIRED");
  });
});
