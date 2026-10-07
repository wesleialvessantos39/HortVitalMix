import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import type { AdminActorContext } from "../middleware/adminSession.ts";
import {
  CommercePolicySchema,
  GatewayPreparationSchema,
  UpdateCommerceSettingsSchema,
  CreatePosSaleSchema,
  AcceptPosSaleSchema,
  type PosSale,
  type OrderView,
  type CommercePolicy,
} from "../../shared/contracts/commerce.ts";
import { getPaymentGateway } from "../payments/gateway.ts";
import {
  commerceTransaction,
  commerceIdentity,
  commerceCommand,
  commerceAdmin,
  commerceAudit,
  CommerceError,
  type CommerceAudit,
} from "./CommerceSupport.ts";

function saleView(row: Record<string, any>): PosSale {
  return {
    id: row.id,
    code: row.code,
    storeName: row.store_snapshot.name,
    totalCents: row.total_cents,
    items: row.items_snapshot,
    paymentMethod: row.payment_method,
    paymentChannel: row.payment_channel,
    status: row.status,
    expiresAt: new Date(row.expires_at).toISOString(),
    policy: CommercePolicySchema.parse(row.policy_snapshot),
    customerAccepted: !!row.accepted_at,
  };
}
export function orderView(
  row: Record<string, any>,
  producer = false,
): OrderView {
  const policy = CommercePolicySchema.parse(row.policy_snapshot),
    received = row.received_at ? new Date(row.received_at) : null;
  const days =
    row.source === "online"
      ? policy.onlineWithdrawalDays
      : policy.inPersonReturnDays;
  return {
    id: row.id,
    orderNumber: `#HVM-${new Date(row.created_at).getFullYear()}-${String(row.order_number).padStart(5, "0")}`,
    storeName: row.store_snapshot.name,
    source: row.source,
    status: row.status,
    ...(row.fulfillment_status ? { fulfillmentStatus: row.fulfillment_status } : {}),
    totalCents: row.total_cents,
    items: row.items_snapshot,
    createdAt: new Date(row.created_at).toISOString(),
    receivedAt: received?.toISOString() ?? null,
    withdrawalDeadline:
      received && days > 0
        ? new Date(received.getTime() + days * 86400000).toISOString()
        : null,
    problemDeadline: received
      ? new Date(received.getTime() + 30 * 86400000).toISOString()
      : null,
    policy,
    holdState: row.hold_state ?? "held",
    ...(producer
      ? { customerUserId: row.customer_user_id }
      : { producerUserId: row.producer_user_id }),
  };
}
async function posOwner(client: PoolClient, userId: string) {
  const actor = await commerceIdentity(client, userId);
  if (!actor.roles.includes("producer"))
    throw new CommerceError("PRODUCER_REQUIRED", 403);
  const store = (
    await client.query(
      `SELECT s.id,s.store_name,s.store_slug FROM public.app_producer_stores s
    JOIN public.app_producer_profiles pp ON pp.id=s.producer_profile_id WHERE pp.person_id=$1 AND hvm_store_private.store_is_visible(s.id)`,
      [actor.person_id],
    )
  ).rows[0];
  if (!store) throw new CommerceError("POS_STORE_UNAVAILABLE", 403);
  return store;
}
export const CommerceService = {
  async policy(): Promise<{
    policy: CommercePolicy;
    gatewayAvailable: boolean;
  }> {
    return commerceTransaction(async (client) => ({
      policy: CommercePolicySchema.parse(
        (
          await client.query(
            "SELECT policy FROM public.app_commerce_settings WHERE id=true",
          )
        ).rows[0].policy,
      ),
      gatewayAvailable: !!getPaymentGateway(),
    }));
  },
  async settings(actor: AdminActorContext) {
    return commerceTransaction(async (client) => {
      // Capability validation is repeated inside the transaction, including revocation.
      await commerceAdmin(
        client,
        actor,
        actor.isSuperAdmin || actor.sectors.includes("refund_management")
          ? "refund_management"
          : "payment_configuration",
      );
      const row = (
        await client.query(
          "SELECT revision,policy,gateway FROM public.app_commerce_settings WHERE id=true",
        )
      ).rows[0];
      return {
        revision: row.revision,
        policy: CommercePolicySchema.parse(row.policy),
        gateway: GatewayPreparationSchema.parse(row.gateway),
        gatewayAvailable: !!getPaymentGateway(),
      };
    });
  },
  async updateSettings(
    actor: AdminActorContext,
    raw: unknown,
    context: CommerceAudit,
  ) {
    const input = UpdateCommerceSettingsSchema.parse(raw);
    return commerceTransaction(async (client) => {
      await commerceAdmin(
        client,
        actor,
        actor.isSuperAdmin || actor.sectors.includes("refund_management")
          ? "refund_management"
          : "payment_configuration",
      );
      return commerceCommand(
        client,
        actor.userId,
        input.commandId,
        "commerce.settings",
        input,
        async () => {
          const current = (
            await client.query(
              "SELECT * FROM public.app_commerce_settings WHERE id=true FOR UPDATE",
            )
          ).rows[0];
          if (current.revision !== input.expectedRevision)
            throw new CommerceError("REVISION_CONFLICT");
          // JSONB property order is immaterial.
          const keys = [
            "onlineWithdrawalDays",
            "inPersonReturnDays",
            "holdingDays",
            "additionalTerms",
          ] as const;
          const changePolicy = keys.some(
            (key) => input.policy[key] !== current.policy[key],
          );
          const changeGateway = Object.keys(input.gateway).some(
            (key) =>
              input.gateway[key as keyof typeof input.gateway] !==
              current.gateway[key],
          );
          if (changePolicy)
            await commerceAdmin(client, actor, "refund_management");
          if (changeGateway)
            await commerceAdmin(client, actor, "payment_configuration");
          const policy = CommercePolicySchema.parse({
            ...input.policy,
            version: current.policy.version + (changePolicy ? 1 : 0),
          });
          await client.query(
            "UPDATE public.app_commerce_settings SET revision=revision+1,policy=$1,gateway=$2,updated_by=$3,updated_at=clock_timestamp() WHERE id=true",
            [
              JSON.stringify(policy),
              JSON.stringify(input.gateway),
              actor.userId,
            ],
          );
          await commerceAudit(
            client,
            actor.userId,
            actor.role,
            "commerce.settings_updated",
            "app_commerce_settings",
            actor.userId,
            { policyVersion: policy.version, provider: input.gateway.provider },
            context,
            input.commandId,
          );
          return {
            revision: current.revision + 1,
            policy,
            gateway: input.gateway,
            gatewayAvailable: !!getPaymentGateway(),
          };
        },
      );
    });
  },
  async posContext(userId: string) {
    return commerceTransaction(async (client) => {
      const store = await posOwner(client, userId);
      const products = (
        await client.query(
          `SELECT p.id,p.title,p.unit_type,price.price_cents,
      coalesce((SELECT sum(l.current_quantity)::int FROM public.app_inventory_lots l WHERE l.product_id=p.id AND l.expiration_date>=CURRENT_DATE),0) AS available_quantity
      FROM public.app_products p JOIN LATERAL(SELECT price_cents FROM public.app_price_versions v WHERE v.product_id=p.id AND v.valid_from<=clock_timestamp() ORDER BY v.valid_from DESC,id DESC LIMIT 1) price ON true
      WHERE p.store_id=$1 AND p.is_published ORDER BY p.title,p.id LIMIT 500`,
          [store.id],
        )
      ).rows.map((row) => ({
        id: row.id,
        title: row.title,
        unitType: row.unit_type,
        priceCents: row.price_cents,
        availableQuantity: row.available_quantity,
      }));
      const sales = (
        await client.query(
          "SELECT * FROM public.app_pos_sales WHERE producer_user_id=$1 ORDER BY created_at DESC LIMIT 100",
          [userId],
        )
      ).rows.map(saleView);
      const orders = (
        await client.query(
          `SELECT o.*,h.state AS hold_state FROM public.app_orders o JOIN public.app_financial_holds h ON h.order_id=o.id WHERE o.producer_user_id=$1 ORDER BY o.created_at DESC LIMIT 100`,
          [userId],
        )
      ).rows.map((row) => orderView(row, true));
      const balance = (
        await client.query(
          `SELECT coalesce(sum(h.amount_cents-h.refunded_cents) FILTER(WHERE h.state IN ('held','partially_refunded')),0)::bigint AS held_cents,
      coalesce(sum(h.amount_cents-h.refunded_cents) FILTER(WHERE h.state IN ('disputed','refund_pending')),0)::bigint AS disputed_cents,
      coalesce(sum(h.refunded_cents),0)::bigint AS refunded_cents FROM public.app_financial_holds h JOIN public.app_orders o ON o.id=h.order_id WHERE o.producer_user_id=$1`,
          [userId],
        )
      ).rows[0];
      return {
        store: { id: store.id, name: store.store_name },
        products,
        sales,
        orders,
        balance: {
          heldCents: Number(balance.held_cents),
          disputedCents: Number(balance.disputed_cents),
          refundedCents: Number(balance.refunded_cents),
        },
        gatewayAvailable: !!getPaymentGateway(),
      };
    });
  },
  async createPosSale(userId: string, raw: unknown, context: CommerceAudit) {
    const input = CreatePosSaleSchema.parse(raw);
    return commerceTransaction(async (client) => {
      const store = await posOwner(client, userId);
      return commerceCommand(
        client,
        userId,
        input.commandId,
        "pos.create",
        input,
        async () => {
          const limit = (
            await client.query(
              "SELECT count(*)::int AS n FROM public.app_pos_sales WHERE producer_user_id=$1 AND status IN ('draft','accepted') AND expires_at>clock_timestamp()",
              [userId],
            )
          ).rows[0].n;
          if (limit >= 50) throw new CommerceError("POS_PENDING_LIMIT");
          const items = [];
          let total = 0;
          for (const item of [...input.items].sort((a, b) =>
            a.productId.localeCompare(b.productId),
          )) {
            const product = (
              await client.query(
                `SELECT p.id,p.title,p.unit_type,price.id AS price_id,price.price_cents,
          coalesce((SELECT sum(l.current_quantity)::int FROM public.app_inventory_lots l WHERE l.product_id=p.id AND l.expiration_date>=CURRENT_DATE),0) AS available_quantity
          FROM public.app_products p JOIN LATERAL(SELECT id,price_cents FROM public.app_price_versions v WHERE v.product_id=p.id AND v.valid_from<=clock_timestamp() ORDER BY v.valid_from DESC,id DESC LIMIT 1) price ON true
          WHERE p.id=$1 AND p.store_id=$2 AND p.is_published FOR SHARE OF p`,
                [item.productId, store.id],
              )
            ).rows[0];
            if (!product) throw new CommerceError("POS_PRODUCT_UNAVAILABLE");
            if (product.available_quantity < item.quantity)
              throw new CommerceError("POS_INSUFFICIENT_STOCK");
            const itemTotal = product.price_cents * item.quantity;
            total += itemTotal;
            if (total > 2147483647)
              throw new CommerceError("POS_TOTAL_TOO_LARGE", 422);
            items.push({
              productId: product.id,
              title: product.title,
              quantity: item.quantity,
              unitType: product.unit_type,
              unitPriceCents: product.price_cents,
              totalPriceCents: itemTotal,
              priceVersionId: product.price_id,
            });
          }
          const policy = CommercePolicySchema.parse(
            (
              await client.query(
                "SELECT policy FROM public.app_commerce_settings WHERE id=true FOR SHARE",
              )
            ).rows[0].policy,
          );
          const sale = (
            await client.query(
              `INSERT INTO public.app_pos_sales(code,producer_user_id,store_id,store_snapshot,items_snapshot,total_cents,payment_method,payment_channel,policy_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
              [
                randomBytes(16).toString("hex"),
                userId,
                store.id,
                JSON.stringify({
                  name: store.store_name,
                  slug: store.store_slug,
                }),
                JSON.stringify(items),
                total,
                input.paymentMethod,
                input.paymentChannel,
                JSON.stringify(policy),
              ],
            )
          ).rows[0];
          await commerceAudit(
            client,
            userId,
            "producer",
            "pos.sale_prepared",
            "app_pos_sales",
            sale.id,
            {
              totalCents: total,
              method: input.paymentMethod,
              channel: input.paymentChannel,
            },
            context,
            input.commandId,
          );
          return saleView(sale);
        },
      );
    });
  },
  async posSale(userId: string, code: string) {
    return commerceTransaction(async (client) => {
      await commerceIdentity(client, userId);
      z.string()
        .regex(/^[a-f0-9]{32}$/)
        .parse(code);
      const sale = (
        await client.query(
          "SELECT * FROM public.app_pos_sales WHERE code=$1 AND (customer_user_id IS NULL OR customer_user_id=$2 OR producer_user_id=$2)",
          [code, userId],
        )
      ).rows[0];
      if (!sale) throw new CommerceError("POS_SALE_NOT_FOUND", 404);
      return saleView(sale);
    });
  },
  async acceptPosSale(
    userId: string,
    code: string,
    raw: unknown,
    context: CommerceAudit,
  ) {
    const input = AcceptPosSaleSchema.parse(raw);
    z.string()
      .regex(/^[a-f0-9]{32}$/)
      .parse(code);
    return commerceTransaction(async (client) => {
      await commerceIdentity(client, userId);
      return commerceCommand(
        client,
        userId,
        input.commandId,
        "pos.accept:" + code,
        input,
        async () => {
          const sale = (
            await client.query(
              "SELECT *,expires_at<=clock_timestamp() AS expired FROM public.app_pos_sales WHERE code=$1 FOR UPDATE",
              [code],
            )
          ).rows[0];
          if (
            !sale ||
            (sale.customer_user_id && sale.customer_user_id !== userId)
          )
            throw new CommerceError("POS_SALE_NOT_FOUND", 404);
          if (sale.producer_user_id === userId)
            throw new CommerceError("POS_SELF_PURCHASE", 403);
          if (
            sale.status === "cancelled" ||
            sale.status === "paid" ||
            sale.expired
          )
            throw new CommerceError("POS_SALE_EXPIRED");
          if (sale.policy_snapshot.version !== input.policyVersion)
            throw new CommerceError("POLICY_CHANGED");
          await client.query(
            "UPDATE public.app_pos_sales SET customer_user_id=$2,status='accepted',accepted_at=coalesce(accepted_at,clock_timestamp()) WHERE id=$1",
            [sale.id, userId],
          );
          await commerceAudit(
            client,
            userId,
            "consumer",
            "pos.sale_accepted",
            "app_pos_sales",
            sale.id,
            { policyVersion: input.policyVersion },
            context,
            input.commandId,
          );
          return {
            accepted: true,
            gatewayAvailable: !!getPaymentGateway(),
            saleId: sale.id,
          };
        },
      );
    });
  },
  async cancelPosSale(
    userId: string,
    id: string,
    commandId: string,
    context: CommerceAudit,
  ) {
    return commerceTransaction(async (client) => {
      await commerceIdentity(client, userId);
      z.uuid().parse(id);
      return commerceCommand(
        client,
        userId,
        commandId,
        "pos.cancel:" + id,
        {},
        async () => {
          const sale = (
            await client.query(
              "SELECT * FROM public.app_pos_sales WHERE id=$1 AND producer_user_id=$2 FOR UPDATE",
              [id, userId],
            )
          ).rows[0];
          if (!sale) throw new CommerceError("POS_SALE_NOT_FOUND", 404);
          if (sale.status === "paid" || sale.reservation_ids.length)
            throw new CommerceError("POS_PAYMENT_IN_PROGRESS");
          await client.query(
            "UPDATE public.app_pos_sales SET status='cancelled' WHERE id=$1",
            [id],
          );
          await commerceAudit(
            client,
            userId,
            "producer",
            "pos.sale_cancelled",
            "app_pos_sales",
            id,
            {},
            context,
            commandId,
          );
          return { status: "cancelled" };
        },
      );
    });
  },
  async purchases(userId: string) {
    return commerceTransaction(async (client) => {
      await commerceIdentity(client, userId);
      return {
        orders: (
          await client.query(
            "SELECT o.*,h.state AS hold_state,(SELECT f.status FROM public.app_order_fulfillment f WHERE f.order_id=o.id) AS fulfillment_status FROM public.app_orders o JOIN public.app_financial_holds h ON h.order_id=o.id WHERE o.customer_user_id=$1 ORDER BY o.created_at DESC LIMIT 100",
            [userId],
          )
        ).rows.map((row) => orderView(row)),
        sales: (
          await client.query(
            "SELECT * FROM public.app_pos_sales WHERE customer_user_id=$1 ORDER BY created_at DESC LIMIT 100",
            [userId],
          )
        ).rows.map(saleView),
        payments: (
          await client.query(
            "SELECT id,method,amount_cents,status,expires_at FROM public.app_payment_intents WHERE user_id=$1 AND status='pending' AND expires_at>clock_timestamp() ORDER BY created_at DESC LIMIT 50",
            [userId],
          )
        ).rows.map((row) => ({
          id: row.id,
          method: row.method,
          amountCents: row.amount_cents,
          expiresAt: row.expires_at.toISOString(),
        })),
      };
    });
  },
  async received(
    userId: string,
    id: string,
    commandId: string,
    context: CommerceAudit,
  ) {
    return commerceTransaction(async (client) => {
      await commerceIdentity(client, userId);
      z.uuid().parse(id);
      return commerceCommand(
        client,
        userId,
        commandId,
        "order.received:" + id,
        {},
        async () => {
          const order = (
            await client.query(
              "SELECT * FROM public.app_orders WHERE id=$1 AND customer_user_id=$2 FOR UPDATE",
              [id, userId],
            )
          ).rows[0];
          if (!order) throw new CommerceError("ORDER_NOT_FOUND", 404);
          if (order.status === "refunded")
            throw new CommerceError("ORDER_REFUNDED");
          if (!order.received_at) {
            const policy = CommercePolicySchema.parse(order.policy_snapshot);
            const days = Math.max(
              policy.holdingDays,
              order.source === "online"
                ? policy.onlineWithdrawalDays
                : policy.inPersonReturnDays,
            );
            await client.query(
              "UPDATE public.app_orders SET received_at=clock_timestamp(),status='received' WHERE id=$1",
              [id],
            );
            await client.query(
              "UPDATE public.app_financial_holds SET release_after=(SELECT received_at FROM public.app_orders WHERE id=$1)+make_interval(days=>$2),updated_at=clock_timestamp() WHERE order_id=$1",
              [id, days],
            );
            await commerceAudit(
              client,
              userId,
              "consumer",
              "order.receipt_confirmed",
              "app_orders",
              id,
              { holdingDays: days },
              context,
              commandId,
            );
          }
          return { received: true };
        },
      );
    });
  },
};
