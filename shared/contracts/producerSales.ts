import { z } from "zod";
import { OrderStatusEnum } from "./order.ts";
export const ProducerSalesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    source: z.enum(["all", "online", "pos"]).default("all"),
    orderId: z.uuid().optional(),
  })
  .strict();
const money = z.number().int().nonnegative();
export const ProducerSaleSchema = z
  .object({
    id: z.uuid(),
    orderNumber: z.string(),
    source: z.enum(["online", "pos"]),
    status: z.enum(["confirmed", "received", "refunded"]),
    fulfillmentStatus: OrderStatusEnum.nullable(),
    totalCents: money,
    refundedCents: money,
    holdState: z.string(),
    createdAt: z.iso.datetime(),
    storeName: z.string(),
    storeSlug: z.string().nullable(),
    openRefundId: z.uuid().nullable(),
    items: z.array(
      z.object({
        productId: z.uuid(),
        title: z.string(),
        quantity: z.number().positive(),
        unitType: z.string(),
        unitPriceCents: money,
        totalPriceCents: money,
      }),
    ),
  })
  .strict();
export const ProducerSalesSchema = z
  .object({
    sales: z.array(ProducerSaleSchema),
    page: z.number().int().positive(),
    pages: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    summary: z.object({
      saleCount: money,
      grossCents: money,
      refundedCents: money,
      heldCents: money,
      disputedCents: money,
      releasedCents: money,
    }),
    posRevisions: z.array(
      z.object({
        id: z.uuid(),
        code: z.string(),
        status: z.enum(["draft", "accepted", "cancelled", "paid"]),
        totalCents: money,
        expiresAt: z.iso.datetime(),
        createdAt: z.iso.datetime(),
      }),
    ),
  })
  .strict();
export const ProducerRefundQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    filter: z.enum(["all", "open", "closed"]).default("all"),
  })
  .strict();
export const SellerContactSchema = z
  .object({
    id: z.uuid(),
    message: z.string().max(4000),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const ProducerRefundSchema = z
  .object({
    id: z.uuid(),
    orderId: z.uuid(),
    orderNumber: z.string(),
    storeName: z.string(),
    status: z.string(),
    reason: z.string(),
    requestedAmountCents: money,
    approvedAmountCents: money.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    history: z.array(
      z.object({ status: z.string(), createdAt: z.iso.datetime() }),
    ),
    contacts: z.array(SellerContactSchema),
  })
  .strict();
export const ProducerRefundListSchema = z
  .object({
    cases: z.array(ProducerRefundSchema),
    page: z.number().int().positive(),
    pages: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type ProducerSale = z.infer<typeof ProducerSaleSchema>;
export type ProducerRefund = z.infer<typeof ProducerRefundSchema>;
