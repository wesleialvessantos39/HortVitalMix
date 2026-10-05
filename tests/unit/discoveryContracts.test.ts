import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  DiscoveryAvatarSchema,
  FavoritesQuerySchema,
  SearchStoresQuerySchema,
  ToggleFavoriteSchema,
} from "../../shared/contracts/discovery.ts";
describe("T17 contratos estritos", () => {
  it("aceita busca vazia, aplica página inicial e limpa texto", () => {
    expect(SearchStoresQuerySchema.parse({})).toEqual({ page: 1 });
    expect(SearchStoresQuerySchema.parse({ query: " couve " }).query).toBe(
      "couve",
    );
  });
  it.each([
    { latitude: 0 },
    { longitude: 0 },
    { latitude: 91, longitude: 0 },
    { latitude: 0, longitude: -181 },
    { latitude: NaN, longitude: 0 },
    { latitude: "0", longitude: "0" },
    { page: 0 },
    { page: 1.5 },
    { page: 1001 },
    { query: "x".repeat(129) },
    { categorySlug: "../privado" },
    { personId: randomUUID() },
  ])("rejeita entrada inválida %j", (input) => {
    expect(SearchStoresQuerySchema.safeParse(input).success).toBe(false);
  });
  it("aceita a origem 0/0 e os limites geográficos", () => {
    expect(
      SearchStoresQuerySchema.parse({ latitude: 0, longitude: 0 }).latitude,
    ).toBe(0);
    expect(
      SearchStoresQuerySchema.safeParse({ latitude: -90, longitude: 180 })
        .success,
    ).toBe(true);
  });
  it("favorito não aceita identidade fornecida pelo cliente nem alvo arbitrário", () => {
    const input = {
      targetType: "store",
      targetId: randomUUID(),
      commandId: randomUUID(),
    };
    expect(ToggleFavoriteSchema.safeParse(input).success).toBe(true);
    expect(
      ToggleFavoriteSchema.safeParse({ ...input, personId: randomUUID() })
        .success,
    ).toBe(false);
    expect(
      ToggleFavoriteSchema.safeParse({ ...input, targetType: "person" })
        .success,
    ).toBe(false);
    expect(
      ToggleFavoriteSchema.safeParse({ ...input, commandId: "" }).success,
    ).toBe(false);
  });
  it("limita consultas de favoritos às vinte lojas da página", () => {
    expect(
      FavoritesQuerySchema.safeParse({
        targetIds: Array.from({ length: 21 }, () => randomUUID()),
      }).success,
    ).toBe(false);
    expect(FavoritesQuerySchema.safeParse({ targetIds: [] }).success).toBe(
      false,
    );
  });
  it.each([
    "javascript:alert(1)",
    "http://example.test/photo.jpg",
    "https://user:secret@example.test/photo.jpg",
  ])("não renderiza avatar inseguro %s", (url) => {
    expect(DiscoveryAvatarSchema.safeParse(url).success).toBe(false);
  });
});
