import { z } from "zod";
import { CutTypeEnum } from "./cart.ts";
import { UnitTypeEnum, PRODUCT_MEDIA_ORIGIN } from "./product.ts";

export const CHECKOUT_QUOTE_TTL_MINUTES = 15;
export const CheckoutCommandIdSchema = z
  .uuid()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/,
  )
  .transform((v) => v.toLowerCase());
export const PaymentMethodEnum = z.enum(["pix", "credit_card", "debit_card"]);
export const CreateQuoteSchema = z
  .object({
    cartId: z.uuid().transform((v) => v.toLowerCase()),
    deliveryAddressId: z.uuid().transform((v) => v.toLowerCase()),
  })
  .strict();
export const ConfirmCheckoutSchema = z
  .object({
    quoteId: z.uuid().transform((v) => v.toLowerCase()),
    paymentMethod: PaymentMethodEnum,
  })
  .strict();
const money = z.number().int().nonnegative().max(2147483647);
export const CheckoutAddressSnapshotSchema = z
  .object({
    id: z.uuid(),
    label: z.string(),
    cep: z.string(),
    street: z.string(),
    number: z.string(),
    complement: z.string().nullable(),
    neighborhood: z.string(),
    city: z.string(),
    state: z.string().length(2),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    deliveryNotes: z.string().nullable(),
    revision: z.number().int().positive(),
  })
  .strict();
export const CheckoutItemSnapshotSchema = z
  .object({
    cartItemId: z.uuid(),
    productId: z.uuid(),
    title: z.string(),
    quantity: z.number().int().min(1).max(99),
    cutType: CutTypeEnum.nullable(),
    unitType: UnitTypeEnum,
    netWeightGrams: z.number().int().positive(),
    unitPriceCents: money.positive(),
    totalPriceCents: money.positive(),
    priceVersionId: z.uuid(),
    mediaPath: z.string().nullable(),
  })
  .strict();
export const CheckoutStoreSnapshotSchema = z
  .object({
    storeId: z.uuid(),
    storeName: z.string(),
    storeSlug: z.string(),
    items: z.array(CheckoutItemSnapshotSchema).min(1).max(1000),
    subtotalCents: money.positive(),
    minOrderCents: money,
    deliveryQuoteId: z.uuid(),
    deliveryFeeCents: money,
    distanceKm: z.number().nonnegative(),
  })
  .strict();
export const CheckoutQuoteResponseSchema = z
  .object({
    id: z.uuid(),
    cartId: z.uuid().nullable(),
    deliveryAddressId: z.uuid().nullable(),
    addressSnapshot: CheckoutAddressSnapshotSchema,
    stores: z
      .array(
        CheckoutStoreSnapshotSchema.omit({ items: true }).extend({
          items: z
            .array(
              CheckoutItemSnapshotSchema.omit({ mediaPath: true })
                .extend({
                  imageUrl: z
                    .url()
                    .refine((v) => new URL(v).origin === PRODUCT_MEDIA_ORIGIN)
                    .nullable(),
                })
                .strict(),
            )
            .min(1)
            .max(1000),
        }),
      )
      .min(1)
      .max(1000),
    subtotalCents: money.positive(),
    deliveryFeeCents: money,
    discountCents: money,
    totalCents: money.positive(),
    expiresAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
    serverTime: z.iso.datetime(),
    isConsumed: z.boolean(),
  })
  .strict()
  .refine(
    (v) =>
      v.totalCents === v.subtotalCents + v.deliveryFeeCents - v.discountCents,
  );
export const CheckoutConfirmationSchema = z
  .object({
    commandId: CheckoutCommandIdSchema,
    quoteId: z.uuid(),
    paymentIntentId: z.uuid(),
    status: z.literal("pending_payment"),
    paymentStatus: z.literal("pending"),
    paymentMethod: PaymentMethodEnum,
    totalCents: money.positive(),
    confirmedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    reservations: z
      .array(
        z
          .object({
            id: z.uuid(),
            productId: z.uuid(),
            lotId: z.uuid(),
            quantity: z.number().int().positive(),
            expiresAt: z.iso.datetime(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export const CheckoutContextSchema = z
  .object({
    cartId: z.uuid(),
    serverTime: z.iso.datetime(),
    pendingConfirmation: CheckoutConfirmationSchema.nullable(),
  })
  .strict();
export type CheckoutQuote = z.infer<typeof CheckoutQuoteResponseSchema>;
export type CheckoutConfirmation = z.infer<typeof CheckoutConfirmationSchema>;
export type CheckoutContext = z.infer<typeof CheckoutContextSchema>;
export type ConfirmCheckout = z.infer<typeof ConfirmCheckoutSchema>;
export type CheckoutStoreSnapshot = z.infer<typeof CheckoutStoreSnapshotSchema>;
