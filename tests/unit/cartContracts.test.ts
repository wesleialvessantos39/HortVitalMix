import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AddCartItemSchema,
  AddHortiMixSchema,
  UpdateCartItemSchema,
  RemoveCartItemSchema,
} from "../../shared/contracts/cart.ts";
describe("T18: contratos da cesta", () => {
  const item = () => ({ productId: randomUUID(), quantity: 1 });
  it("aceita porções inteiras e os cinco cortes homologados", () => {
    for (const cutType of [
      null,
      "rodelas",
      "cubos",
      "tiras",
      "picado_fino",
      "folhas_inteiras",
    ])
      expect(AddCartItemSchema.safeParse({ ...item(), cutType }).success).toBe(
        true,
      );
  });
  it.each([0, 100, -1, 1.5, "2", NaN])(
    "rejeita quantidade inválida %s",
    (quantity) => {
      expect(AddCartItemSchema.safeParse({ ...item(), quantity }).success).toBe(
        false,
      );
    },
  );
  it("não recebe dono, loja, preço ou identificador de cesta do cliente", () => {
    for (const key of [
      "userId",
      "sessionId",
      "storeId",
      "cartId",
      "priceCents",
    ])
      expect(
        AddCartItemSchema.safeParse({ ...item(), [key]: randomUUID() }).success,
      ).toBe(false);
    expect(
      AddCartItemSchema.safeParse({ ...item(), cutType: "processado" }).success,
    ).toBe(false);
  });
  it("mix tem limite, itens estritos e chave para repetição segura", () => {
    expect(
      AddHortiMixSchema.safeParse({
        items: [{ ...item(), cutType: "cubos" }],
        commandId: randomUUID(),
      }).success,
    ).toBe(true);
    expect(
      AddHortiMixSchema.safeParse({ items: [], commandId: randomUUID() })
        .success,
    ).toBe(false);
    expect(
      AddHortiMixSchema.safeParse({
        items: Array.from({ length: 31 }, item),
        commandId: randomUUID(),
      }).success,
    ).toBe(false);
    expect(AddHortiMixSchema.safeParse({ items: [item()] }).success).toBe(
      false,
    );
  });
  it("atualização absoluta e remoção exigem commandId", () => {
    expect(
      UpdateCartItemSchema.safeParse({ quantity: 2, commandId: randomUUID() })
        .success,
    ).toBe(true);
    expect(
      UpdateCartItemSchema.safeParse({ quantity: 100, commandId: randomUUID() })
        .success,
    ).toBe(false);
    expect(
      RemoveCartItemSchema.safeParse({ commandId: randomUUID() }).success,
    ).toBe(true);
    expect(RemoveCartItemSchema.safeParse({}).success).toBe(false);
  });
});
