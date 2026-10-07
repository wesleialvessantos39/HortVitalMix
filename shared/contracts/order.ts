import { z } from "zod";
import { CheckoutAddressSnapshotSchema } from "./checkout.ts";

export const OrderStatusEnum = z.enum([
  "confirmed",
  "in_preparation",
  "ready_for_dispatch",
  "out_for_delivery",
  "delivered",
  "cancelled",
]);
export type OrderStatus = z.infer<typeof OrderStatusEnum>;
export const ORDER_TRANSITIONS: Readonly<
  Record<OrderStatus, readonly OrderStatus[]>
> = {
  confirmed: ["in_preparation", "cancelled"],
  in_preparation: ["ready_for_dispatch", "cancelled"],
  ready_for_dispatch: ["out_for_delivery"],
  out_for_delivery: ["delivered"],
  delivered: [],
  cancelled: [],
};
export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  confirmed: "Pagamento confirmado",
  in_preparation: "Em preparo",
  ready_for_dispatch: "Pronto para entrega",
  out_for_delivery: "Saiu para entrega",
  delivered: "Entregue",
  cancelled: "Cancelado",
};
export const TransitionOrderSchema = z
  .object({
    expectedRevision: z.number().int().positive().max(2147483646),
    toStatus: OrderStatusEnum,
    notes: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.toStatus === "cancelled" && (value.notes?.length ?? 0) < 10)
      context.addIssue({
        code: "custom",
        path: ["notes"],
        message:
          "Informe o motivo do cancelamento com pelo menos 10 caracteres.",
      });
  });
export const OrderIdSchema = z.uuid().transform((value) => value.toLowerCase());
export const OrderListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    status: z.union([OrderStatusEnum, z.literal("all")]).default("all"),
    orderId: z.uuid().optional(),
  })
  .strict();
const cents = z.number().int().nonnegative().max(2147483647);
export const OrderItemSchema = z
  .object({
    id: z.uuid(),
    productId: z.uuid().nullable(),
    title: z.string(),
    packaging: z.string(),
    netWeightGrams: z.number().int().positive(),
    unitType: z.string(),
    cutType: z.string().nullable(),
    quantity: z.number().int().positive(),
    unitPriceCents: cents.positive(),
    totalPriceCents: cents.positive(),
  })
  .strict();
export const OrderEventSchema = z
  .object({
    id: z.uuid(),
    fromStatus: OrderStatusEnum.nullable(),
    toStatus: OrderStatusEnum,
    actorRole: z.enum(["payment_gateway", "producer"]),
    notes: z.string().nullable(),
    revision: z.number().int().positive(),
    occurredAt: z.iso.datetime(),
  })
  .strict();
export const OrderSummarySchema = z
  .object({
    id: z.uuid(),
    orderNumber: z.string(),
    storeName: z.string(),
    status: OrderStatusEnum,
    revision: z.number().int().positive(),
    commercialStatus: z.enum(["confirmed", "received", "refunded"]),
    subtotalCents: cents.positive(),
    deliveryFeeCents: cents,
    totalCents: cents.positive(),
    itemCount: z.number().int().positive(),
    cancellationReason: z.string().nullable(),
    receivedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    allowedTransitions: z.array(OrderStatusEnum),
  })
  .strict();
export const OrderResponseSchema = OrderSummarySchema.extend({
  address: CheckoutAddressSnapshotSchema.nullable(),
  items: z.array(OrderItemSchema),
  events: z.array(OrderEventSchema),
  refundState: z.string().nullable(),
}).strict();
export const OrderListResponseSchema = z
  .object({
    orders: z.array(OrderSummarySchema),
    page: z.number().int().positive(),
    pages: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    counts: z
      .object({
        confirmed: z.number().int().nonnegative(),
        in_preparation: z.number().int().nonnegative(),
        ready_for_dispatch: z.number().int().nonnegative(),
        out_for_delivery: z.number().int().nonnegative(),
        delivered: z.number().int().nonnegative(),
        cancelled: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type OrderSummary = z.infer<typeof OrderSummarySchema>;
export type OrderDetail = z.infer<typeof OrderResponseSchema>;
export type OrderList = z.infer<typeof OrderListResponseSchema>;
