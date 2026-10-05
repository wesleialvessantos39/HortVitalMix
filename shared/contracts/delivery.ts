import { z } from "zod";

export const ARIQUEMES_CENTER = { latitude: -9.9133, longitude: -63.0408 };
const money = z.number().int().nonnegative().max(2147483647);
export const ServiceAreaSchema = z
  .object({
    radiusKm: z.number().min(1).max(150).multipleOf(0.01),
    centerLatitude: z.number().min(-90).max(90),
    centerLongitude: z.number().min(-180).max(180),
  })
  .strict();
export const DeliveryRulesSchema = z
  .object({
    baseFeeCents: money,
    feePerKmCents: money,
    minOrderCents: money,
    freeDeliveryThresholdCents: z
      .number()
      .int()
      .positive()
      .max(2147483647)
      .nullable(),
    estimatedPrepHours: z.number().int().positive().max(2147483647).default(4),
  })
  .strict();
export const SaveDeliverySettingsSchema = z
  .object({
    commandId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    radiusKm: ServiceAreaSchema.shape.radiusKm,
    isActive: z.boolean(),
    rules: DeliveryRulesSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.rules.baseFeeCents +
        Math.round(value.radiusKm * value.rules.feePerKmCents) <=
      2147483647,
    {
      path: ["rules", "feePerKmCents"],
      message: "A tarifa calculada ultrapassa o limite permitido.",
    },
  );
export const DeliverySettingsResponseSchema = z
  .object({
    store: z.object({ id: z.uuid(), name: z.string() }).strict().nullable(),
    origin: z
      .object({
        propertyId: z.uuid(),
        propertyName: z.string(),
        centerLatitude: ServiceAreaSchema.shape.centerLatitude,
        centerLongitude: ServiceAreaSchema.shape.centerLongitude,
      })
      .strict()
      .nullable(),
    serviceArea: ServiceAreaSchema.extend({ isActive: z.boolean() }).nullable(),
    rules: DeliveryRulesSchema,
    revision: z.number().int().nonnegative(),
    canConfigure: z.boolean(),
    ariquemesDistanceKm: z.number().nonnegative().nullable(),
  })
  .strict();
export const DeliveryQuoteResponseSchema = z
  .object({
    id: z.uuid(),
    storeId: z.uuid(),
    destinationAddressId: z.uuid(),
    distanceKm: z.number().nonnegative(),
    feeCents: money,
    minOrderCents: money,
    isEligible: z.boolean(),
    ineligibilityReason: z.string().nullable(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
// Internal callers supply the authenticated identity and an authoritative subtotal.
// This is not a cart/checkout HTTP contract and never accepts a client-owned subtotal.
export const CalculateDeliveryQuoteSchema = z
  .object({
    storeId: z.uuid(),
    destinationAddressId: z.uuid(),
    personId: z.uuid(),
    userId: z.uuid(),
    subtotalCents: money,
  })
  .strict();
export type DeliverySettings = z.infer<typeof DeliverySettingsResponseSchema>;
export type SaveDeliverySettings = z.infer<typeof SaveDeliverySettingsSchema>;
export type DeliveryQuote = z.infer<typeof DeliveryQuoteResponseSchema>;

/** Geodesic distance only: the operational quote always uses PostgreSQL. */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  if (
    ![lat1, lon1, lat2, lon2].every(Number.isFinite) ||
    Math.abs(lat1) > 90 ||
    Math.abs(lat2) > 90 ||
    Math.abs(lon1) > 180 ||
    Math.abs(lon2) > 180
  )
    throw new RangeError("Coordenadas inválidas");
  const radians = (n: number) => (n * Math.PI) / 180;
  const a =
    Math.sin(radians(lat2 - lat1) / 2) ** 2 +
    Math.cos(radians(lat1)) *
      Math.cos(radians(lat2)) *
      Math.sin(radians(lon2 - lon1) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}
