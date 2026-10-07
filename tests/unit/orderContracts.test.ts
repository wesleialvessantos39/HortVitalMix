import { describe, expect, it } from "vitest";
import {
  OrderListQuerySchema,
  TransitionOrderSchema,
} from "../../shared/contracts/order.ts";
describe("T21: contratos de preparo e rastreamento", () => {
  it("exige revisão inteira positiva e rejeita campos de autoridade do cliente", () => {
    for (const expectedRevision of [0, -1, 1.5, "1"])
      expect(
        TransitionOrderSchema.safeParse({
          toStatus: "in_preparation",
          expectedRevision,
        }).success,
      ).toBe(false);
    expect(
      TransitionOrderSchema.safeParse({
        toStatus: "in_preparation",
        expectedRevision: 1,
        actorRole: "platform_super_admin",
      }).success,
    ).toBe(false);
    expect(
      TransitionOrderSchema.safeParse({
        toStatus: "in_preparation",
        expectedRevision: 1,
        customerUserId: "forged",
      }).success,
    ).toBe(false);
  });
  it("cancelamento exige motivo significativo e limitado", () => {
    for (const notes of [undefined, "", "   ", "curto", "a".repeat(501)])
      expect(
        TransitionOrderSchema.safeParse({
          toStatus: "cancelled",
          expectedRevision: 1,
          notes,
        }).success,
      ).toBe(false);
    expect(
      TransitionOrderSchema.parse({
        toStatus: "cancelled",
        expectedRevision: 1,
        notes: "  Falta de qualidade na colheita.  ",
      }).notes,
    ).toBe("Falta de qualidade na colheita.");
  });
  it("não aceita os estados financeiros T20 como etapas de preparo", () => {
    for (const toStatus of [
      "received",
      "refunded",
      "paid",
      "completed",
      "pending_payment",
    ])
      expect(
        TransitionOrderSchema.safeParse({ toStatus, expectedRevision: 1 })
          .success,
      ).toBe(false);
  });
  it("consulta paginada é limitada e não aceita titularidade enviada pelo cliente", () => {
    expect(OrderListQuerySchema.parse({})).toEqual({ page: 1, status: "all" });
    expect(
      OrderListQuerySchema.parse({ page: "2", status: "in_preparation" }).page,
    ).toBe(2);
    for (const input of [
      { page: 0 },
      { page: "1;select" },
      { page: 100001 },
      { status: "paid" },
      { userId: "other" },
    ])
      expect(OrderListQuerySchema.safeParse(input).success).toBe(false);
  });
});
