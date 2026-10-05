import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  RegisterHarvestSchema,
  RegisterHarvestCommandSchema,
  ReserveStockSchema,
  InventoryQuerySchema,
  RESERVATION_TTL_MINUTES,
  addInventoryDays,
} from "../../shared/contracts/inventory.ts";
const harvest = {
  lotCode: " COUVE-01 ",
  harvestDate: "2026-10-05",
  expirationDate: "2026-10-10",
  quantity: 10,
};
describe("T15 contratos de estoque", () => {
  it("normaliza código e valida comando sem aceitar titular imposto", () => {
    expect(RegisterHarvestSchema.parse(harvest).lotCode).toBe("COUVE-01");
    expect(
      RegisterHarvestCommandSchema.safeParse({
        ...harvest,
        commandId: randomUUID(),
      }).success,
    ).toBe(true);
    expect(
      RegisterHarvestCommandSchema.safeParse({
        ...harvest,
        commandId: randomUUID(),
        userId: randomUUID(),
      }).success,
    ).toBe(false);
  });
  it.each([0, -1, 1.5, 2147483648, NaN, Infinity, "2"])(
    "recusa quantidade de colheita %s",
    (quantity) => {
      expect(
        RegisterHarvestSchema.safeParse({ ...harvest, quantity }).success,
      ).toBe(false);
    },
  );
  it.each(["", " ", "x".repeat(65)])("recusa código inválido %s", (lotCode) => {
    expect(
      RegisterHarvestSchema.safeParse({ ...harvest, lotCode }).success,
    ).toBe(false);
  });
  it.each(["2026-02-30", "05/10/2026", "2026-10-05T00:00:00Z"])(
    "recusa data inválida %s",
    (harvestDate) => {
      expect(
        RegisterHarvestSchema.safeParse({ ...harvest, harvestDate }).success,
      ).toBe(false);
    },
  );
  it("não aceita validade anterior à colheita, mas aceita mesmo dia", () => {
    expect(
      RegisterHarvestSchema.safeParse({
        ...harvest,
        expirationDate: "2026-10-04",
      }).success,
    ).toBe(false);
    expect(
      RegisterHarvestSchema.safeParse({
        ...harvest,
        expirationDate: harvest.harvestDate,
      }).success,
    ).toBe(true);
  });
  it.each([0, -1, 100, 1.1, "1"])("recusa reserva inválida %s", (quantity) => {
    expect(
      ReserveStockSchema.safeParse({
        productId: randomUUID(),
        quantity,
        cartSessionId: "session-123",
      }).success,
    ).toBe(false);
  });
  it("contrato centraliza TTL e permite apenas sessão opaca, sem identidade", () => {
    expect(RESERVATION_TTL_MINUTES).toBe(15);
    expect(
      ReserveStockSchema.safeParse({
        productId: randomUUID(),
        quantity: 99,
        cartSessionId: "session_123",
      }).success,
    ).toBe(true);
    expect(
      ReserveStockSchema.safeParse({
        productId: randomUUID(),
        quantity: 1,
        cartSessionId: "email@example.test",
      }).success,
    ).toBe(false);
  });
  it("paginação estrita não coage listas, zero ou filtros privados", () => {
    expect(InventoryQuerySchema.parse({})).toEqual({
      lotsPage: 1,
      movementsPage: 1,
    });
    expect(
      InventoryQuerySchema.parse({ lotsPage: "2", movementsPage: "3" }),
    ).toEqual({ lotsPage: 2, movementsPage: 3 });
    for (const input of [
      { lotsPage: "0" },
      { lotsPage: ["1", "2"] },
      { userId: randomUUID() },
    ])
      expect(InventoryQuerySchema.safeParse(input).success).toBe(false);
  });
  it("validade sugerida soma dias sem deslocar o dia no fuso", () => {
    expect(addInventoryDays("2026-12-30", 5)).toBe("2027-01-04");
    expect(addInventoryDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});
