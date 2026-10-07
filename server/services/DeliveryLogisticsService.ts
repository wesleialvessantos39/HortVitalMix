import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import {
  DeliveryWindowSchema,
  DeliveryWindowUpdateSchema,
  AllocateDeliverySchema,
  DeliveryProofSchema,
  DeliveryWindowsResponseSchema,
  DeliveryTrackingResponseSchema,
  ScheduledDateSchema,
} from "../../shared/contracts/deliveryLogistics.ts";
import { OrderIdSchema } from "../../shared/contracts/order.ts";
import { OrderService } from "./OrderService.ts";
import {
  CommerceError,
  commerceTransaction,
  commerceIdentity,
  commerceCommand,
  commerceAudit,
  type CommerceAudit,
} from "./CommerceSupport.ts";
async function transaction<T>(run: (c: PoolClient) => Promise<T>) {
  return commerceTransaction(async (c) => {
    try {
      return await run(c);
    } catch (e) {
      const error = e as { code?: string; message?: string };
      const known = [
        "WINDOW_DEACTIVATE_REQUIRED",
        "REVISION_CONFLICT",
        "WINDOW_HAS_ALLOCATIONS",
        "CAPACITY_BELOW_ALLOCATIONS",
        "ORDER_NOT_READY",
        "WINDOW_UNAVAILABLE",
        "INVALID_DELIVERY_DATE",
        "CAPACITY_EXCEEDED",
        "ORDER_NOT_OUT_FOR_DELIVERY",
        "ORDER_ACTOR_REQUIRED",
        "DELIVERY_PROOF_NOT_ATOMIC",
        "DELIVERY_RECORD_IMMUTABLE",
      ];
      if (error.code === "23514" && known.includes(error.message ?? ""))
        throw new CommerceError(
          error.message!,
          error.message === "ORDER_ACTOR_REQUIRED" ? 403 : 409,
        );
      throw e;
    }
  });
}
async function producerStore(c: PoolClient, userId: string) {
  const actor = await commerceIdentity(c, userId);
  if (!actor.roles.includes("producer"))
    throw new CommerceError("PRODUCER_REQUIRED", 403);
  const store = (
    await c.query<{ id: string }>(
      `SELECT s.id FROM public.app_producer_stores s JOIN public.app_producer_profiles p ON p.id=s.producer_profile_id WHERE p.person_id=$1`,
      [actor.person_id],
    )
  ).rows[0];
  if (!store) throw new CommerceError("STORE_NOT_FOUND", 404);
  return store.id;
}
async function lockOrder(c: PoolClient, id: string, userId: string) {
  const store = await producerStore(c, userId);
  const order = (
    await c.query(
      `SELECT o.id FROM public.app_orders o WHERE o.id=$1 AND o.store_id=$2 AND o.producer_user_id=$3 AND o.source='online' FOR UPDATE`,
      [id, store, userId],
    )
  ).rows[0];
  if (!order) throw new CommerceError("ORDER_NOT_FOUND", 404);
  const state = (
    await c.query<{ status: string; revision: number }>(
      `SELECT status,revision FROM public.app_order_fulfillment WHERE order_id=$1 FOR UPDATE`,
      [id],
    )
  ).rows[0];
  if (!state) throw new CommerceError("ORDER_NOT_FOUND", 404);
  return state;
}
async function clock(c: PoolClient) {
  return (
    (
      await c.query<{ today: string; timezone: string }>(
        `SELECT coalesce(timezone,'America/Porto_Velho') AS timezone,to_char(clock_timestamp() AT TIME ZONE coalesce(timezone,'America/Porto_Velho'),'YYYY-MM-DD') AS today FROM public.app_global_config WHERE singleton_guard`,
      )
    ).rows[0] ?? {
      today: new Date().toISOString().slice(0, 10),
      timezone: "America/Porto_Velho",
    }
  );
}
const fields = `id,store_id AS "storeId",day_of_week AS "dayOfWeek",to_char(start_time,'HH24:MI') AS "startTime",to_char(end_time,'HH24:MI') AS "endTime",max_orders_capacity AS "maxOrdersCapacity",is_active AS "isActive",revision`;
function childCommand(parent: string) {
  const h = createHash("sha256")
    .update("t22:proof-transition:" + parent)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export const DeliveryLogisticsService = {
  async listWindows(userId: string, dateInput?: string) {
    return transaction(async (c) => {
      const store = await producerStore(c, userId),
        now = await clock(c),
        date = ScheduledDateSchema.parse(dateInput ?? now.today);
      const windows = (
        await c.query(
          `SELECT ${fields},(SELECT count(*)::integer FROM public.app_delivery_allocations a WHERE a.window_id=w.id AND a.scheduled_date=$2::date) AS "allocatedCount" FROM public.app_delivery_windows w WHERE store_id=$1 ORDER BY day_of_week,start_time,id`,
          [store, date],
        )
      ).rows;
      return DeliveryWindowsResponseSchema.parse({ windows, ...now, date });
    });
  },
  async saveWindow(
    userId: string,
    idInput: string | null,
    input: unknown,
    commandId: string,
    context: CommerceAudit,
  ) {
    const id = idInput ? OrderIdSchema.parse(idInput) : null,
      body = id
        ? DeliveryWindowUpdateSchema.parse(input)
        : DeliveryWindowSchema.parse(input);
    return transaction(async (c) => {
      const store = await producerStore(c, userId);
      return commerceCommand(
        c,
        userId,
        commandId,
        "delivery.window:" + (id ?? "create"),
        body,
        async () => {
          let row;
          if (id) {
            const old = (
              await c.query(
                `SELECT revision FROM public.app_delivery_windows WHERE id=$1 AND store_id=$2 FOR UPDATE`,
                [id, store],
              )
            ).rows[0];
            if (!old) throw new CommerceError("WINDOW_NOT_FOUND", 404);
            if (
              old.revision !==
              DeliveryWindowUpdateSchema.parse(body).expectedRevision
            )
              throw new CommerceError("REVISION_CONFLICT", 409);
            row = (
              await c.query(
                `UPDATE public.app_delivery_windows SET day_of_week=$3,start_time=$4,end_time=$5,max_orders_capacity=$6,is_active=$7,revision=revision+1 WHERE id=$1 AND store_id=$2 RETURNING ${fields}`,
                [
                  id,
                  store,
                  body.dayOfWeek,
                  body.startTime,
                  body.endTime,
                  body.maxOrdersCapacity,
                  body.isActive,
                ],
              )
            ).rows[0];
          } else
            row = (
              await c.query(
                `INSERT INTO public.app_delivery_windows(store_id,day_of_week,start_time,end_time,max_orders_capacity,is_active) VALUES($1,$2,$3,$4,$5,$6) RETURNING ${fields}`,
                [
                  store,
                  body.dayOfWeek,
                  body.startTime,
                  body.endTime,
                  body.maxOrdersCapacity,
                  body.isActive,
                ],
              )
            ).rows[0];
          await commerceAudit(
            c,
            userId,
            "producer",
            "delivery.window_saved",
            "app_delivery_windows",
            row.id,
            { revision: row.revision, capacity: body.maxOrdersCapacity },
            context,
            commandId,
          );
          return { ...row, allocatedCount: 0 };
        },
      );
    });
  },
  async allocateOrderToWindow(
    orderId: string,
    userId: string,
    input: unknown,
    commandId: string,
    context: CommerceAudit,
  ) {
    const id = OrderIdSchema.parse(orderId),
      body = AllocateDeliverySchema.parse(input);
    return transaction(async (c) => {
      const state = await lockOrder(c, id, userId);
      return commerceCommand(
        c,
        userId,
        commandId,
        "delivery.allocate:" + id,
        body,
        async () => {
          if (state.revision !== body.expectedRevision)
            throw new CommerceError("REVISION_CONFLICT", 409);
          const existing = (
            await c.query(
              `SELECT window_id,scheduled_date::text FROM public.app_delivery_allocations WHERE order_id=$1`,
              [id],
            )
          ).rows[0];
          if (existing) {
            if (
              existing.window_id === body.windowId &&
              existing.scheduled_date === body.scheduledDate
            )
              return { allocated: true };
            throw new CommerceError("ORDER_ALREADY_ALLOCATED", 409);
          }
          if (state.status !== "ready_for_dispatch")
            throw new CommerceError("ORDER_NOT_READY", 409);
          await c.query(
            `INSERT INTO public.app_delivery_allocations(window_id,scheduled_date,order_id,window_snapshot) VALUES($1,$2,$3,'{}')`,
            [body.windowId, body.scheduledDate, id],
          );
          await commerceAudit(
            c,
            userId,
            "producer",
            "delivery.allocated",
            "app_orders",
            id,
            { windowId: body.windowId, scheduledDate: body.scheduledDate },
            context,
            commandId,
          );
          return { allocated: true };
        },
      );
    });
  },
  async registerDeliveryProof(
    orderId: string,
    userId: string,
    input: unknown,
    commandId: string,
    context: CommerceAudit,
  ) {
    const id = OrderIdSchema.parse(orderId),
      body = DeliveryProofSchema.parse(input);
    return transaction(async (c) => {
      const state = await lockOrder(c, id, userId);
      return commerceCommand(
        c,
        userId,
        commandId,
        "delivery.proof:" + id,
        body,
        async () => {
          if (state.revision !== body.expectedRevision)
            throw new CommerceError("REVISION_CONFLICT", 409);
          if (state.status !== "out_for_delivery")
            throw new CommerceError("ORDER_NOT_OUT_FOR_DELIVERY", 409);
          await c.query(
            `SELECT set_config('hvm.order_actor_user_id',$1,true),set_config('hvm.order_actor_role','producer',true)`,
            [userId],
          );
          await c.query(
            `INSERT INTO public.app_delivery_proofs(order_id,received_by_name,receiver_document_masked,notes,delivery_latitude,delivery_longitude,recorded_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [
              id,
              body.receivedByName,
              body.receiverDocumentLastDigits
                ? `***.***.${body.receiverDocumentLastDigits}-**`
                : null,
              body.notes ?? null,
              body.latitude ?? null,
              body.longitude ?? null,
              userId,
            ],
          );
          const order = await OrderService.transitionStatus(
            id,
            userId,
            "producer",
            { toStatus: "delivered", expectedRevision: body.expectedRevision },
            childCommand(commandId),
            context,
            c,
          );
          await commerceAudit(
            c,
            userId,
            "producer",
            "delivery.proof_recorded",
            "app_orders",
            id,
            { revision: order.revision },
            context,
            commandId,
          );
          return order;
        },
      );
    });
  },
  async tracking(orderId: string, userId: string) {
    const id = OrderIdSchema.parse(orderId);
    return transaction(async (c) => {
      await commerceIdentity(c, userId);
      const order = (
        await c.query(
          `SELECT customer_user_id FROM public.app_orders WHERE id=$1 AND (customer_user_id=$2 OR producer_user_id=$2)`,
          [id, userId],
        )
      ).rows[0];
      if (!order) throw new CommerceError("ORDER_NOT_FOUND", 404);
      const allocation =
        (
          await c.query(
            `SELECT window_id AS "windowId",scheduled_date::text AS "scheduledDate",window_snapshot->>'startTime' AS "startTime",window_snapshot->>'endTime' AS "endTime",window_snapshot->>'timezone' AS timezone FROM public.app_delivery_allocations WHERE order_id=$1`,
            [id],
          )
        ).rows[0] ?? null;
      const recorded = !!(
        await c.query(
          "SELECT 1 FROM public.app_delivery_proofs WHERE order_id=$1",
          [id],
        )
      ).rowCount;
      const proof =
        recorded && order.customer_user_id === userId
          ? (
              await c.query(
                `SELECT received_by_name AS "receivedByName",receiver_document_masked AS "receiverDocumentMasked",notes,delivery_latitude::float8 AS latitude,delivery_longitude::float8 AS longitude,delivered_at AS "deliveredAt" FROM public.app_delivery_proofs WHERE order_id=$1`,
                [id],
              )
            ).rows[0]
          : null;
      if (proof) proof.deliveredAt = proof.deliveredAt.toISOString();
      return DeliveryTrackingResponseSchema.parse({
        allocation,
        proofRecorded: recorded,
        proof,
      });
    });
  },
};
