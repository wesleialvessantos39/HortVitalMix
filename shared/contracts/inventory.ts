import { z } from "zod";
import { UnitTypeEnum } from "./product.ts";

export const RESERVATION_TTL_MINUTES = 15;
export const INVENTORY_LOTS_PAGE_SIZE = 20;
export const INVENTORY_MOVEMENTS_PAGE_SIZE = 50;
const quantity = z.number().int().positive().max(2147483647);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const RegisterHarvestSchema = z
  .object({
    lotCode: z.string().trim().min(1).max(64),
    harvestDate: z.iso.date(),
    expirationDate: z.iso.date(),
    quantity,
  })
  .strict()
  .refine((value) => value.expirationDate >= value.harvestDate, {
    path: ["expirationDate"],
    message: "A validade deve ser igual ou posterior à colheita.",
  });
export const RegisterHarvestCommandSchema = RegisterHarvestSchema.safeExtend({
  commandId: z.uuid(),
});
export const ReserveStockSchema = z
  .object({
    productId: z.uuid(),
    quantity: quantity.max(99),
    cartSessionId: z
      .string()
      .trim()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();
const page = z
  .string()
  .regex(/^[1-9]\d{0,5}$/)
  .transform(Number);
export const InventoryQuerySchema = z
  .object({
    lotsPage: page.default(1),
    movementsPage: page.default(1),
  })
  .strict();
export const InventoryLotSchema = z
  .object({
    id: z.uuid(),
    lotCode: z.string(),
    harvestDate: z.iso.date(),
    expirationDate: z.iso.date(),
    initialQuantity: quantity,
    currentQuantity: count,
    reservedQuantity: count,
    expiresInDays: z.number().int(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const InventoryMovementTypeEnum = z.enum([
  "harvest_entry",
  "order_sale",
  "loss_waste",
  "manual_adjustment",
]);
export const InventoryMovementSchema = z
  .object({
    id: z.uuid(),
    lotId: z.uuid(),
    lotCode: z.string(),
    movementType: InventoryMovementTypeEnum,
    quantityDelta: z.number().int().min(-2147483647).max(2147483647),
    reasonDescription: z.string(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const InventoryResponseSchema = z
  .object({
    product: z
      .object({
        id: z.uuid(),
        title: z.string(),
        unitType: UnitTypeEnum,
        shelfLifeDays: quantity,
      })
      .strict(),
    businessDate: z.iso.date(),
    canRegisterHarvest: z.boolean(),
    availableQuantity: count,
    reservedQuantity: count,
    lots: z.array(InventoryLotSchema),
    movements: z.array(InventoryMovementSchema),
    pagination: z
      .object({
        lotsPage: quantity,
        lotsTotal: count,
        movementsPage: quantity,
        movementsTotal: count,
      })
      .strict(),
  })
  .strict();
export const HarvestResponseSchema = z
  .object({ lotId: z.uuid(), inventory: InventoryResponseSchema })
  .strict();
export const ReservationSchema = z
  .object({
    id: z.uuid(),
    productId: z.uuid(),
    lotId: z.uuid(),
    quantity,
    expiresAt: z.iso.datetime(),
  })
  .strict();
export const ReserveStockResponseSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("reserved"),
      reservations: z.array(ReservationSchema).min(1),
    })
    .strict(),
  z.object({ status: z.literal("insufficient_stock") }).strict(),
]);
export type RegisterHarvest = z.infer<typeof RegisterHarvestCommandSchema>;
export type Inventory = z.infer<typeof InventoryResponseSchema>;
export type InventoryQuery = z.infer<typeof InventoryQuerySchema>;
export type StockReservation = z.infer<typeof ReservationSchema>;
export type ReserveStockResult = z.infer<typeof ReserveStockResponseSchema>;
export const INVENTORY_MOVEMENT_LABELS: Record<
  z.infer<typeof InventoryMovementTypeEnum>,
  string
> = {
  harvest_entry: "Entrada de colheita",
  order_sale: "Venda",
  loss_waste: "Perda ou descarte",
  manual_adjustment: "Ajuste manual",
};
export function addInventoryDays(date: string, days: number) {
  const value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
