import { z } from "zod";
import { UnitTypeEnum, PRODUCT_MEDIA_ORIGIN } from "./product.ts";

export const CutTypeEnum = z.enum([
  "rodelas",
  "cubos",
  "tiras",
  "picado_fino",
  "folhas_inteiras",
]);
export const CUT_TYPE_LABELS: Record<z.infer<typeof CutTypeEnum>, string> = {
  rodelas: "Rodelas",
  cubos: "Cubos",
  tiras: "Tiras",
  picado_fino: "Picado fino",
  folhas_inteiras: "Folhas inteiras",
};
const quantity = z.number().int().min(1).max(99);
export const AddCartItemSchema = z
  .object({
    productId: z.uuid(),
    quantity,
    cutType: CutTypeEnum.nullable().optional(),
    commandId: z.uuid().optional(),
  })
  .strict();
export const AddHortiMixSchema = z
  .object({
    items: z
      .array(AddCartItemSchema.omit({ commandId: true }))
      .min(1)
      .max(30),
    commandId: z.uuid(),
  })
  .strict();
export const UpdateCartItemSchema = z
  .object({ quantity, commandId: z.uuid() })
  .strict();
export const RemoveCartItemSchema = z.object({ commandId: z.uuid() }).strict();
export const CartSessionSchema = z.uuid().regex(/^[0-9a-f-]{36}$/);
export const CartByStoreResponseSchema = z.array(
  z
    .object({
      storeId: z.uuid(),
      storeName: z.string(),
      storeSlug: z.string(),
      items: z.array(
        z
          .object({
            id: z.uuid(),
            productId: z.uuid(),
            title: z.string(),
            quantity,
            unitPriceCents: z.number().int().nonnegative(),
            cutType: CutTypeEnum.nullable(),
            unitType: UnitTypeEnum,
            netWeightGrams: z.number().int().positive(),
            imageUrl: z
              .string()
              .url()
              .refine((v) => new URL(v).origin === PRODUCT_MEDIA_ORIGIN)
              .nullable(),
            available: z.boolean(),
          })
          .strict(),
      ),
      subtotalCents: z.number().int().nonnegative(),
      meetsMinOrder: z.boolean(),
      minOrderCents: z.number().int().nonnegative(),
    })
    .strict(),
);
export const CartResponseSchema = z
  .object({
    stores: CartByStoreResponseSchema,
    itemCount: z.number().int().nonnegative(),
    subtotalCents: z.number().int().nonnegative(),
  })
  .strict();
export type AddCartItem = z.infer<typeof AddCartItemSchema>;
export type Cart = z.infer<typeof CartResponseSchema>;
