import type { PoolClient } from "pg";
import {
  OrderIdSchema,
  OrderListQuerySchema,
  OrderListResponseSchema,
  OrderResponseSchema,
  ORDER_TRANSITIONS,
  TransitionOrderSchema,
  type OrderDetail,
  type OrderStatus,
  type OrderSummary,
} from "../../shared/contracts/order.ts";
import {
  CommerceError,
  commerceIdentity,
  commerceTransaction,
  commerceCommand,
  commerceAudit,
  type CommerceAudit,
} from "./CommerceSupport.ts";

const pageSize = 20;
type OrderRow = {
  id: string;
  order_number: string;
  store_snapshot: { name: string };
  customer_user_id: string;
  producer_user_id: string | null;
  store_id: string | null;
  commercial_status: "confirmed" | "received" | "refunded";
  status: OrderStatus;
  revision: number;
  cancellation_reason: string | null;
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  received_at: Date | null;
  created_at: Date;
  updated_at: Date;
  item_count: string;
  address_snapshot: OrderDetail["address"];
  hold_state: string | null;
};
const fields = `o.id,o.order_number::text,o.customer_user_id,o.producer_user_id,o.store_id,o.store_snapshot,
  o.status AS commercial_status,o.subtotal_cents,o.delivery_fee_cents,o.total_cents,o.received_at,
  o.created_at,o.address_snapshot,f.status,f.revision,f.cancellation_reason,f.updated_at,
  (SELECT sum(i.quantity)::text FROM public.app_order_items i WHERE i.order_id=o.id) AS item_count`;
function summary(row: OrderRow, producer: boolean): OrderSummary {
  const allowed =
    producer && row.commercial_status !== "refunded"
      ? ORDER_TRANSITIONS[row.status].filter(
          (status) => status !== "cancelled" || !row.received_at,
        )
      : [];
  return {
    id: row.id,
    orderNumber: `#HVM-${new Date(row.created_at).getFullYear()}-${row.order_number.padStart(5, "0")}`,
    storeName: row.store_snapshot.name,
    status: row.status,
    revision: row.revision,
    commercialStatus: row.commercial_status,
    subtotalCents: row.subtotal_cents,
    deliveryFeeCents: row.delivery_fee_cents,
    totalCents: row.total_cents,
    itemCount: Number(row.item_count),
    cancellationReason: row.cancellation_reason,
    receivedAt: row.received_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    allowedTransitions: allowed,
  };
}
async function transaction<T>(
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return commerceTransaction(async (client) => {
    try {
      return await run(client);
    } catch (error) {
      const e = error as { code?: string; message?: string };
      if (e.code === "23514" && e.message) {
        const errors: Record<string, number> = {
          ILLEGAL_TRANSITION: 422,
          REVISION_CONFLICT: 409,
          ORDER_ACTOR_REQUIRED: 403,
          CANCELLATION_REASON_REQUIRED: 422,
          ORDER_ALREADY_RECEIVED: 409,
          ORDER_REFUNDED: 409,
          ORDER_CANCELLED: 409,
          ORDER_PAYMENT_NOT_APPROVED: 422,
          ORDER_STOCK_RETURN_REQUIRED: 409,
          ORDER_REFUND_REQUEST_REQUIRED: 409,
        };
        if (errors[e.message])
          throw new CommerceError(e.message, errors[e.message]);
      }
      throw error;
    }
  });
}
async function detail(
  client: PoolClient,
  orderId: string,
  userId: string,
): Promise<OrderDetail> {
  const row = (
    await client.query<OrderRow>(
      `SELECT ${fields},h.state AS hold_state FROM public.app_orders o
     JOIN public.app_order_fulfillment f ON f.order_id=o.id
     LEFT JOIN public.app_financial_holds h ON h.order_id=o.id
     WHERE o.id=$1 AND (o.customer_user_id=$2 OR o.producer_user_id=$2)`,
      [orderId, userId],
    )
  ).rows[0];
  if (!row) throw new CommerceError("ORDER_NOT_FOUND", 404);
  const items = (
    await client.query(
      `SELECT id,product_id AS "productId",product_title_snapshot AS title,packaging_snapshot AS packaging,
      net_weight_grams AS "netWeightGrams",unit_type AS "unitType",cut_type AS "cutType",quantity,
      unit_price_cents AS "unitPriceCents",total_price_cents AS "totalPriceCents"
     FROM public.app_order_items WHERE order_id=$1 ORDER BY item_position`,
      [orderId],
    )
  ).rows;
  const events = (
    await client.query(
      `SELECT id,from_status AS "fromStatus",to_status AS "toStatus",actor_role AS "actorRole",notes,revision,
      occurred_at AS "occurredAt" FROM public.app_order_events WHERE order_id=$1 ORDER BY revision`,
      [orderId],
    )
  ).rows.map((event) => ({
    ...event,
    occurredAt: event.occurredAt.toISOString(),
  }));
  return OrderResponseSchema.parse({
    ...summary(row, row.producer_user_id === userId),
    address: row.address_snapshot,
    items,
    events,
    refundState: row.hold_state,
  });
}
async function returnStock(
  client: PoolClient,
  orderId: string,
  userId: string,
) {
  const located = (
    await client.query<{ lot_id: string }>(
      "SELECT DISTINCT lot_id FROM public.app_inventory_reservations WHERE consumed_order_id=$1 AND is_consumed ORDER BY lot_id",
      [orderId],
    )
  ).rows;
  // Same global lots-first order as T15, before locking reservations.
  await client.query(
    "SELECT id FROM public.app_inventory_lots WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
    [located.map((row) => row.lot_id)],
  );
  const reservations = (
    await client.query<{ id: string; lot_id: string; quantity: number }>(
      "SELECT id,lot_id,quantity FROM public.app_inventory_reservations WHERE consumed_order_id=$1 AND is_consumed ORDER BY lot_id,id FOR UPDATE",
      [orderId],
    )
  ).rows;
  for (const reservation of reservations) {
    if (
      (
        await client.query(
          "SELECT 1 FROM public.app_order_stock_returns WHERE reservation_id=$1",
          [reservation.id],
        )
      ).rowCount
    )
      continue;
    const movement = (
      await client.query<{ id: string }>(
        `INSERT INTO public.app_inventory_movements(lot_id,movement_type,quantity_delta,reason_description,actor_user_id)
       VALUES($1,'manual_adjustment',$2,$3,$4) RETURNING id`,
        [
          reservation.lot_id,
          reservation.quantity,
          "Devolução por cancelamento do pedido " + orderId,
          userId,
        ],
      )
    ).rows[0];
    await client.query(
      "UPDATE public.app_inventory_lots SET current_quantity=current_quantity+$2 WHERE id=$1",
      [reservation.lot_id, reservation.quantity],
    );
    await client.query(
      "INSERT INTO public.app_order_stock_returns(reservation_id,order_id,lot_id,movement_id,quantity) VALUES($1,$2,$3,$4,$5)",
      [
        reservation.id,
        orderId,
        reservation.lot_id,
        movement.id,
        reservation.quantity,
      ],
    );
  }
}
async function cancellationRefund(
  client: PoolClient,
  orderId: string,
  actorId: string,
  reason: string,
) {
  const hold = (
    await client.query<{
      amount_cents: number;
      refunded_cents: number;
      state: string;
    }>(
      "SELECT * FROM public.app_financial_holds WHERE order_id=$1 FOR UPDATE",
      [orderId],
    )
  ).rows[0];
  if (!hold || hold.state === "released")
    throw new CommerceError("ORDER_FINANCIAL_STATE_CONFLICT", 409);
  const remaining = hold.amount_cents - hold.refunded_cents;
  if (!remaining) return;
  const existing = (
    await client.query<{
      requested_amount_cents: number;
      approved_amount_cents: number | null;
    }>(
      "SELECT requested_amount_cents,approved_amount_cents FROM public.app_refund_requests WHERE order_id=$1 AND status NOT IN ('rejected','refunded') FOR UPDATE",
      [orderId],
    )
  ).rows[0];
  if (
    existing &&
    (existing.approved_amount_cents ?? existing.requested_amount_cents) <
      remaining
  )
    throw new CommerceError("ORDER_REFUND_IN_PROGRESS", 409);
  if (!existing) {
    const request = (
      await client.query<{ id: string }>(
        `INSERT INTO public.app_refund_requests(order_id,requester_user_id,reason,description,requested_amount_cents)
       SELECT id,customer_user_id,'other',$2,$3 FROM public.app_orders WHERE id=$1 RETURNING id`,
        [orderId, "Pedido cancelado pelo produtor: " + reason, remaining],
      )
    ).rows[0];
    await client.query(
      `INSERT INTO public.app_case_history(refund_id,actor_user_id,status,notes)
       VALUES($1,$2,'requested',$3)`,
      [
        request.id,
        actorId,
        "Cancelamento do pedido: " +
          reason +
          ". Valor retido; devolução financeira depende da análise e confirmação do gateway.",
      ],
    );
  }
  await client.query(
    "UPDATE public.app_financial_holds SET state=CASE WHEN state='refund_pending' THEN state ELSE 'disputed' END,updated_at=clock_timestamp() WHERE order_id=$1",
    [orderId],
  );
}
export const OrderService = {
  /** T20 already owns multi-store order creation. Finalize its T21 facts in that transaction. */
  async createFromApprovedIntent(paymentIntentId: string, client: PoolClient) {
    const id = OrderIdSchema.parse(paymentIntentId);
    const intent = (
      await client.query(
        "SELECT id,status FROM public.app_payment_intents WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (intent?.status !== "approved")
      throw new CommerceError("ORDER_PAYMENT_NOT_APPROVED", 422);
    const orders = (
      await client.query<{ id: string }>(
        "SELECT id FROM public.app_orders WHERE payment_intent_id=$1 AND source='online' ORDER BY id",
        [id],
      )
    ).rows;
    for (const order of orders)
      await client.query("SELECT hvm_orders_private.capture_order($1)", [
        order.id,
      ]);
    return { orderIds: orders.map((order) => order.id) };
  },
  async list(userId: string, scope: "customer" | "producer", input: unknown) {
    const query = OrderListQuerySchema.parse(input);
    return transaction(async (client) => {
      const actor = await commerceIdentity(client, userId);
      if (scope === "producer" && !actor.roles.includes("producer"))
        throw new CommerceError("PRODUCER_REQUIRED", 403);
      const ownership =
        scope === "producer"
          ? "o.producer_user_id=$1"
          : "o.customer_user_id=$1";
      const counts: Record<OrderStatus, number> = {
        confirmed: 0,
        in_preparation: 0,
        ready_for_dispatch: 0,
        out_for_delivery: 0,
        delivered: 0,
        cancelled: 0,
      };
      for (const row of (
        await client.query<{ status: OrderStatus; count: string }>(
          `SELECT f.status,count(*)::text FROM public.app_orders o JOIN public.app_order_fulfillment f ON f.order_id=o.id WHERE ${ownership} GROUP BY f.status`,
          [userId],
        )
      ).rows)
        counts[row.status] = Number(row.count);
      const total =
        query.status === "all"
          ? Object.values(counts).reduce((a, b) => a + b, 0)
          : counts[query.status];
      const pages = Math.max(1, Math.ceil(total / pageSize)),
        page = Math.min(query.page, pages);
      const rows = (
        await client.query<OrderRow>(
          `SELECT ${fields} FROM public.app_orders o JOIN public.app_order_fulfillment f ON f.order_id=o.id
         WHERE ${ownership} AND ($2='all' OR f.status=$2) ORDER BY o.created_at DESC,o.id DESC LIMIT $3 OFFSET $4`,
          [userId, query.status, pageSize, (page - 1) * pageSize],
        )
      ).rows;
      return OrderListResponseSchema.parse({
        orders: rows.map((row) => summary(row, scope === "producer")),
        page,
        pages,
        total,
        counts,
      });
    });
  },
  async get(orderId: string, userId: string) {
    const id = OrderIdSchema.parse(orderId);
    return transaction(async (client) => {
      await commerceIdentity(client, userId);
      return detail(client, id, userId);
    });
  },
  async transitionStatus(
    orderId: string,
    actorUserId: string,
    actorRole: string,
    input: unknown,
    commandId: string,
    context: CommerceAudit,
  ) {
    const id = OrderIdSchema.parse(orderId),
      body = TransitionOrderSchema.parse(input);
    return transaction(async (client) => {
      const actor = await commerceIdentity(client, actorUserId);
      if (actorRole !== "producer" || !actor.roles.includes("producer"))
        throw new CommerceError("PRODUCER_REQUIRED", 403);
      const order = (
        await client.query(
          `SELECT o.* FROM public.app_orders o JOIN public.app_producer_stores s ON s.id=o.store_id
         JOIN public.app_producer_profiles p ON p.id=s.producer_profile_id
         WHERE o.id=$1 AND o.producer_user_id=$2 AND p.person_id=$3 AND o.source='online' FOR UPDATE OF o`,
          [id, actorUserId, actor.person_id],
        )
      ).rows[0];
      if (!order) throw new CommerceError("ORDER_NOT_FOUND", 404);
      return commerceCommand(
        client,
        actorUserId,
        commandId,
        "order.transition:" + id,
        body,
        async () => {
          const state = (
            await client.query<{ status: OrderStatus; revision: number }>(
              "SELECT status,revision FROM public.app_order_fulfillment WHERE order_id=$1 FOR UPDATE",
              [id],
            )
          ).rows[0];
          if (!state) throw new CommerceError("ORDER_NOT_FOUND", 404);
          if (state.revision !== body.expectedRevision)
            throw new CommerceError("REVISION_CONFLICT", 409);
          if (!ORDER_TRANSITIONS[state.status].includes(body.toStatus))
            throw new CommerceError("ILLEGAL_TRANSITION", 422);
          if (order.status === "refunded")
            throw new CommerceError("ORDER_REFUNDED", 409);
          if (body.toStatus === "cancelled" && order.received_at)
            throw new CommerceError("ORDER_ALREADY_RECEIVED", 409);
          await client.query(
            "SELECT set_config('hvm.order_actor_user_id',$1,true),set_config('hvm.order_actor_role','producer',true),set_config('hvm.order_notes',$2,true)",
            [actorUserId, body.notes ?? ""],
          );
          await client.query(
            "UPDATE public.app_order_fulfillment SET status=$2,revision=revision+1 WHERE order_id=$1",
            [id, body.toStatus],
          );
          if (body.toStatus === "cancelled") {
            await returnStock(client, id, actorUserId);
            await cancellationRefund(client, id, actorUserId, body.notes!);
          }
          await commerceAudit(
            client,
            actorUserId,
            "producer",
            "order.status_changed",
            "app_orders",
            id,
            {
              fromStatus: state.status,
              toStatus: body.toStatus,
              revision: state.revision + 1,
            },
            context,
            commandId,
          );
          return detail(client, id, actorUserId);
        },
      );
    });
  },
  async cancelOrder(
    orderId: string,
    actorUserId: string,
    reason: string,
    expectedRevision: number,
    commandId: string,
    context: CommerceAudit,
  ) {
    return OrderService.transitionStatus(
      orderId,
      actorUserId,
      "producer",
      { expectedRevision, toStatus: "cancelled", notes: reason },
      commandId,
      context,
    );
  },
};
