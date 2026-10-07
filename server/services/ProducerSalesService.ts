import { z } from "zod";
import {
  ProducerSalesQuerySchema,
  ProducerSalesSchema,
  ProducerRefundQuerySchema,
  ProducerRefundListSchema,
  ProducerRefundSchema,
} from "../../shared/contracts/producerSales.ts";
import {
  commerceTransaction,
  commerceIdentity,
  CommerceError,
} from "./CommerceSupport.ts";
const number = (n: unknown) => Number(n ?? 0);
const orderNumber = (r: Record<string, any>) =>
  `#HVM-${new Date(r.order_created_at ?? r.created_at).getFullYear()}-${String(r.order_number).padStart(5, "0")}`;
export const ProducerSalesService = {
  async sales(userId: string, input: unknown) {
    const q = ProducerSalesQuerySchema.parse(input);
    return commerceTransaction(async (c) => {
      await commerceIdentity(c, userId, "producer");
      const summary = (
        await c.query(
          `SELECT count(*) AS sale_count,coalesce(sum(o.total_cents),0) AS gross_cents,coalesce(sum(h.refunded_cents),0) AS refunded_cents,
    coalesce(sum(h.amount_cents-h.refunded_cents) FILTER(WHERE h.state IN ('held','partially_refunded')),0) AS held_cents,
    coalesce(sum(h.amount_cents-h.refunded_cents) FILTER(WHERE h.state IN ('disputed','refund_pending')),0) AS disputed_cents,
    coalesce(sum(h.amount_cents-h.refunded_cents) FILTER(WHERE h.state='released'),0) AS released_cents
    FROM public.app_orders o JOIN public.app_financial_holds h ON h.order_id=o.id WHERE o.producer_user_id=$1`,
          [userId],
        )
      ).rows[0];
      const args = [userId, q.source, q.orderId ?? null];
      const total = number(
        (
          await c.query(
            "SELECT count(*) AS n FROM public.app_orders WHERE producer_user_id=$1 AND ($2='all' OR source=$2) AND ($3::uuid IS NULL OR id=$3)",
            args,
          )
        ).rows[0].n,
      );
      const pages = Math.max(1, Math.ceil(total / 30)),
        page = Math.min(q.page, pages);
      const rows = (
        await c.query(
          `SELECT o.*,h.state AS hold_state,h.refunded_cents,f.status AS fulfillment_status,s.store_slug,
    (SELECT r.id FROM public.app_refund_requests r WHERE r.order_id=o.id AND r.status NOT IN ('rejected','refunded') ORDER BY r.created_at DESC LIMIT 1) AS open_refund_id
    FROM public.app_orders o JOIN public.app_financial_holds h ON h.order_id=o.id LEFT JOIN public.app_order_fulfillment f ON f.order_id=o.id
    LEFT JOIN public.app_producer_stores s ON s.id=o.store_id WHERE o.producer_user_id=$1 AND ($2='all' OR o.source=$2) AND ($3::uuid IS NULL OR o.id=$3)
    ORDER BY o.created_at DESC,o.id DESC LIMIT 30 OFFSET $4`,
          [...args, (page - 1) * 30],
        )
      ).rows;
      const pos = (
        await c.query(
          "SELECT id,code,status,total_cents,expires_at,created_at FROM public.app_pos_sales WHERE producer_user_id=$1 AND status IN ('draft','accepted','cancelled') ORDER BY created_at DESC LIMIT 30",
          [userId],
        )
      ).rows;
      return ProducerSalesSchema.parse({
        sales: rows.map((r) => ({
          id: r.id,
          orderNumber: orderNumber(r),
          source: r.source,
          status: r.status,
          fulfillmentStatus: r.fulfillment_status ?? null,
          totalCents: r.total_cents,
          refundedCents: r.refunded_cents,
          holdState: r.hold_state,
          createdAt: r.created_at.toISOString(),
          storeName: r.store_snapshot.name,
          storeSlug: r.store_slug ?? null,
          openRefundId: r.open_refund_id ?? null,
          items: r.items_snapshot,
        })),
        page,
        pages,
        total,
        summary: {
          saleCount: number(summary.sale_count),
          grossCents: number(summary.gross_cents),
          refundedCents: number(summary.refunded_cents),
          heldCents: number(summary.held_cents),
          disputedCents: number(summary.disputed_cents),
          releasedCents: number(summary.released_cents),
        },
        posRevisions: pos.map((r) => ({
          id: r.id,
          code: r.code,
          status: r.status,
          totalCents: r.total_cents,
          expiresAt: r.expires_at.toISOString(),
          createdAt: r.created_at.toISOString(),
        })),
      });
    });
  },
  async refunds(userId: string, input: unknown, id?: string) {
    const q = ProducerRefundQuerySchema.parse(input);
    if (id) z.uuid().parse(id);
    return commerceTransaction(async (c) => {
      await commerceIdentity(c, userId, "producer");
      const args: unknown[] = [userId];
      const where = `o.producer_user_id=$1${id ? ` AND r.id=$${args.push(id)}` : ""}${q.filter === "all" ? "" : ` AND r.status ${q.filter === "open" ? "NOT IN" : "IN"} ('rejected','refunded')`}`;
      const total = number(
        (
          await c.query(
            `SELECT count(*) AS n FROM public.app_refund_requests r JOIN public.app_orders o ON o.id=r.order_id WHERE ${where}`,
            args,
          )
        ).rows[0].n,
      );
      if (id && !total) throw new CommerceError("CASE_NOT_FOUND", 404);
      const pages = Math.max(1, Math.ceil(total / 30)),
        page = Math.min(q.page, pages);
      const rows = (
        await c.query(
          `SELECT r.id,r.order_id,r.status,r.reason,r.requested_amount_cents,r.approved_amount_cents,r.created_at,r.updated_at,o.order_number,o.created_at AS order_created_at,o.store_snapshot
    FROM public.app_refund_requests r JOIN public.app_orders o ON o.id=r.order_id WHERE ${where} ORDER BY r.created_at DESC,r.id DESC LIMIT 30 OFFSET $${args.push((page - 1) * 30)}`,
          args,
        )
      ).rows;
      const ids = rows.map((r) => r.id);
      // Explicit projection: requester identity, description, private messages,
      // administrative notes, gateway references and evidence never enter this DTO.
      const history = (
        await c.query(
          "SELECT refund_id,status,created_at FROM public.app_case_history WHERE refund_id=ANY($1::uuid[]) ORDER BY created_at,id",
          [ids],
        )
      ).rows;
      const contacts = (
        await c.query(
          "SELECT id,refund_id,message,created_at FROM public.app_refund_seller_contacts WHERE refund_id=ANY($1::uuid[]) ORDER BY created_at,id",
          [ids],
        )
      ).rows;
      const cases = rows.map((r) => ({
        id: r.id,
        orderId: r.order_id,
        orderNumber: orderNumber(r),
        storeName: r.store_snapshot.name,
        status: r.status,
        reason: r.reason,
        requestedAmountCents: r.requested_amount_cents,
        approvedAmountCents: r.approved_amount_cents ?? null,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
        history: history
          .filter((h) => h.refund_id === r.id)
          .map((h) => ({
            status: h.status,
            createdAt: h.created_at.toISOString(),
          })),
        contacts: contacts
          .filter((h) => h.refund_id === r.id)
          .map((h) => ({
            id: h.id,
            message: h.message,
            createdAt: h.created_at.toISOString(),
          })),
      }));
      return id
        ? ProducerRefundSchema.parse(cases[0])
        : ProducerRefundListSchema.parse({ cases, total, page, pages });
    });
  },
};
