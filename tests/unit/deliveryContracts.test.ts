import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ServiceAreaSchema,
  DeliveryRulesSchema,
  SaveDeliverySettingsSchema,
  DeliveryQuoteResponseSchema,
  haversineKm,
} from "../../shared/contracts/delivery.ts";
const rules = {
  baseFeeCents: 500,
  feePerKmCents: 100,
  minOrderCents: 2000,
  freeDeliveryThresholdCents: null,
  estimatedPrepHours: 4,
};
const command = () => ({
  commandId: randomUUID(),
  expectedRevision: 0,
  radiusKm: 15,
  isActive: true,
  rules,
});
describe("T16 contratos e Haversine", () => {
  it.each([1, 15.25, 150])("aceita raio %s", (radiusKm) =>
    expect(
      ServiceAreaSchema.safeParse({
        radiusKm,
        centerLatitude: -9.9133,
        centerLongitude: -63.0408,
      }).success,
    ).toBe(true),
  );
  it.each([0, 0.99, 150.01, Infinity, NaN])("recusa raio %s", (radiusKm) =>
    expect(
      SaveDeliverySettingsSchema.safeParse({ ...command(), radiusKm }).success,
    ).toBe(false),
  );
  it("limita coordenadas e impede alteração da sede pelo cliente", () => {
    expect(
      ServiceAreaSchema.safeParse({
        radiusKm: 15,
        centerLatitude: 91,
        centerLongitude: -63,
      }).success,
    ).toBe(false);
    for (const field of [
      "centerLatitude",
      "centerLongitude",
      "personId",
      "storeId",
      "propertyId",
    ])
      expect(
        SaveDeliverySettingsSchema.safeParse({
          ...command(),
          [field]: randomUUID(),
        }).success,
      ).toBe(false);
  });
  it("valida centavos inteiros, preparo positivo e frete grátis opcional", () => {
    for (const change of [
      { baseFeeCents: -1 },
      { feePerKmCents: 0.5 },
      { minOrderCents: -10 },
      { freeDeliveryThresholdCents: 0 },
      { estimatedPrepHours: 0 },
    ])
      expect(
        DeliveryRulesSchema.safeParse({ ...rules, ...change }).success,
      ).toBe(false);
    expect(
      DeliveryRulesSchema.parse({ ...rules, estimatedPrepHours: undefined })
        .estimatedPrepHours,
    ).toBe(4);
    expect(
      DeliveryRulesSchema.safeParse({
        ...rules,
        freeDeliveryThresholdCents: 10000,
      }).success,
    ).toBe(true);
  });
  it("impede estouro do frete máximo da área", () =>
    expect(
      SaveDeliverySettingsSchema.safeParse({
        ...command(),
        rules: { ...rules, feePerKmCents: 2147483647 },
      }).success,
    ).toBe(false));
  it("valida identificadores, revisão e resposta de cotação", () => {
    expect(
      SaveDeliverySettingsSchema.safeParse({
        ...command(),
        expectedRevision: -1,
      }).success,
    ).toBe(false);
    expect(
      DeliveryQuoteResponseSchema.safeParse({
        id: randomUUID(),
        storeId: randomUUID(),
        destinationAddressId: randomUUID(),
        distanceKm: 5,
        feeCents: 1000,
        minOrderCents: 2000,
        isEligible: true,
        ineligibilityReason: null,
        expiresAt: "2026-10-05T12:00:00.000Z",
      }).success,
    ).toBe(true);
  });
  it("Ariquemes–Porto Velho tem cerca de 159 km em linha reta", () =>
    expect(haversineKm(-9.9133, -63.0408, -8.7612, -63.9004)).toBeGreaterThan(
      158,
    ));
  it("é estável em distância zero, centímetros e antípodas", () => {
    expect(haversineKm(-9.91, -63.04, -9.91, -63.04)).toBe(0);
    expect(haversineKm(0, 0, 0.0000001, 0)).toBeCloseTo(0.00001111949, 9);
    expect(haversineKm(0, 0, 0, 180)).toBeCloseTo(20015.0868, 3);
  });
  it("rejeita coordenadas inválidas", () =>
    expect(() => haversineKm(NaN, 0, 0, 0)).toThrow(RangeError));
});
