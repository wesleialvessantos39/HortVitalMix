import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CheckoutCommandIdSchema,
  ConfirmCheckoutSchema,
  CreateQuoteSchema,
  CHECKOUT_QUOTE_TTL_MINUTES,
} from "../../shared/contracts/checkout.ts";
import { checkoutPayloadHash } from "../../server/services/CheckoutService.ts";
describe("T19: fronteira de cotação e comando", () => {
  it("TTL é 15 minutos e métodos ficam restritos ao contrato", () => {
    expect(CHECKOUT_QUOTE_TTL_MINUTES).toBe(15);
    for (const paymentMethod of ["pix", "credit_card"])
      expect(
        ConfirmCheckoutSchema.safeParse({
          quoteId: randomUUID(),
          paymentMethod,
        }).success,
      ).toBe(true);
    expect(
      ConfirmCheckoutSchema.safeParse({
        quoteId: randomUUID(),
        paymentMethod: "paid",
      }).success,
    ).toBe(false);
  });
  it("X-Command-Id exige UUID v4 e normaliza caixa", () => {
    const id = randomUUID();
    expect(CheckoutCommandIdSchema.parse(id.toUpperCase())).toBe(id);
    for (const v of [
      undefined,
      "",
      id + "," + id,
      "00000000-0000-1000-8000-000000000000",
      [id, id],
    ])
      expect(CheckoutCommandIdSchema.safeParse(v).success).toBe(false);
  });
  it("cotação só recebe IDs, nunca proprietário, preços, frete ou snapshot", () => {
    const base = { cartId: randomUUID(), deliveryAddressId: randomUUID() };
    expect(CreateQuoteSchema.parse(base)).toEqual(base);
    for (const k of [
      "userId",
      "personId",
      "sessionId",
      "storeId",
      "totalCents",
      "itemsSnapshot",
      "discountCents",
    ])
      expect(
        CreateQuoteSchema.safeParse({ ...base, [k]: randomUUID() }).success,
      ).toBe(false);
  });
  it("confirmação não recebe status, valor ou chave pelo body", () => {
    const base = { quoteId: randomUUID(), paymentMethod: "pix" };
    for (const k of [
      "commandId",
      "userId",
      "totalCents",
      "isConsumed",
      "approved",
      "reservations",
    ])
      expect(
        ConfirmCheckoutSchema.safeParse({ ...base, [k]: randomUUID() }).success,
      ).toBe(false);
  });
  it("hash tem 64 caracteres e mesma semântica normalizada; alterações divergem", () => {
    const quoteId = randomUUID();
    const hash = checkoutPayloadHash({ quoteId, paymentMethod: "pix" });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      checkoutPayloadHash({
        paymentMethod: "pix",
        quoteId: quoteId.toUpperCase(),
      }),
    ).toBe(hash);
    expect(
      checkoutPayloadHash({ quoteId, paymentMethod: "credit_card" }),
    ).not.toBe(hash);
  });
});
