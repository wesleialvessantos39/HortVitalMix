import { hasAdminPermission } from "../../shared/adminPermissions.ts";
import {
  AdminCatalogQuerySchema,
  AdminCatalogResponseSchema,
  AdminFinanceQuerySchema,
  AdminFinanceResponseSchema,
  type AdminCatalogResponse,
  type AdminFinanceResponse,
} from "../../shared/contracts/adminOperations.ts";
import type { AdminActorContext } from "../middleware/adminSession.ts";
import { dbPool } from "../db/pool.ts";
import { commerceAdmin, commerceTransaction } from "./CommerceSupport.ts";

export class AdminOperationsError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}
function authorize(
  actor: AdminActorContext,
  sector: "finance_ops" | "catalog_moderation",
) {
  if (!hasAdminPermission(actor, sector))
    throw new AdminOperationsError("FORBIDDEN", 403);
  if (!dbPool) throw new AdminOperationsError("DEPARTMENT_UNAVAILABLE", 503);
  return dbPool;
}
function parse<T>(
  schema: {
    safeParse: (
      value: unknown,
    ) => { success: true; data: T } | { success: false };
  },
  input: unknown,
  code = "DEPARTMENT_FILTER_INVALID",
  status = 400,
): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new AdminOperationsError(code, status);
  return result.data;
}
const emptyArray = "'[]'::jsonb";

export const AdminOperationsService = {
  async finance(
    actor: AdminActorContext,
    input: unknown = {},
    now = new Date(),
  ): Promise<AdminFinanceResponse> {
    authorize(actor, "finance_ops");
    const filters = parse(AdminFinanceQuerySchema, input);
    const to =
      filters.to ??
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Cuiaba",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);
    const from =
      filters.from ??
      new Date(Date.parse(to) - 29 * 86400000).toISOString().slice(0, 10);
    // Defaults are validated as well: a supplied start cannot silently produce
    // an inverted or unbounded interval when the end was omitted.
    parse(AdminFinanceQuerySchema, { ...filters, from, to });
    const paymentView = filters.view === "payments";
    const filtered = paymentView
      ? `SELECT * FROM period_payments WHERE ($3::text='all' OR status=$3)`
      : `SELECT * FROM period_orders WHERE ($4::text='all' OR hold_state=$4)`;
    const rows = paymentView
      ? `SELECT jsonb_build_object('id',p.id,'method',p.method,'status',p.status,
          'source',CASE WHEN p.billing_cycle_id IS NOT NULL THEN 'subscription' WHEN p.pos_sale_id IS NOT NULL THEN 'pos' ELSE 'online' END,
          'amountCents',p.amount_cents,'createdAt',p.created_at,'expiresAt',p.expires_at,
          'orderCount',(SELECT count(*) FROM public.app_orders o WHERE o.payment_intent_id=p.id)) AS item,
          p.created_at,p.id FROM page_rows p`
      : `SELECT jsonb_build_object('id',o.id,'orderNumber',o.order_number::text,'storeName',o.store_name,
          'status',o.status,'totalCents',o.total_cents,'holdState',o.hold_state,
          'retainedCents',coalesce(o.hold_amount-o.refunded_cents,0),'refundedCents',coalesce(o.refunded_cents,0),
          'createdAt',o.created_at,'releaseAfter',o.release_after) AS item,o.created_at,o.id FROM page_rows o`;
    return commerceTransaction(async (client) => {
      await commerceAdmin(client, actor, "finance_ops");
      const result = await client.query<{ response: unknown }>(
        `WITH requested_filters AS (SELECT $3::text AS payment_status,$4::text AS hold_state),
       period_payments AS MATERIALIZED (
         SELECT id,method,status,amount_cents,created_at,expires_at,billing_cycle_id,pos_sale_id
         FROM public.app_payment_intents WHERE created_at >= ($1::date::timestamp AT TIME ZONE 'America/Cuiaba')
           AND created_at < (($2::date+1)::timestamp AT TIME ZONE 'America/Cuiaba')
       ), period_orders AS MATERIALIZED (
         SELECT o.id,o.order_number,o.status,o.total_cents,o.created_at,
           coalesce(s.store_name,o.store_snapshot->>'name','Loja removida') AS store_name,
           h.state AS hold_state,h.amount_cents AS hold_amount,h.refunded_cents,h.release_after
         FROM public.app_orders o LEFT JOIN public.app_producer_stores s ON s.id=o.store_id
         LEFT JOIN public.app_financial_holds h ON h.order_id=o.id
         WHERE o.created_at >= ($1::date::timestamp AT TIME ZONE 'America/Cuiaba')
           AND o.created_at < (($2::date+1)::timestamp AT TIME ZONE 'America/Cuiaba')
       ), filtered AS (${filtered}), page_rows AS (
         SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT $5::int OFFSET $6::int
       ), items AS (${rows})
       SELECT jsonb_build_object('generatedAt',clock_timestamp(),'view',$7::text,
         'period',jsonb_build_object('from',$1::text,'to',$2::text),
         'pagination',jsonb_build_object('page',$8::int,'pageSize',$5::int,'total',(SELECT count(*) FROM filtered)),
         'metrics',jsonb_build_object(
           'approvedPayments',(SELECT count(*) FROM period_payments WHERE status='approved'),
           'approvedAmountCents',(SELECT coalesce(sum(amount_cents::bigint),0) FROM period_payments WHERE status='approved'),
           'heldAmountCents',(SELECT coalesce(sum((hold_amount-refunded_cents)::bigint),0) FROM period_orders WHERE hold_state IN ('held','disputed','refund_pending','partially_refunded')),
           'releasedAmountCents',(SELECT coalesce(sum((hold_amount-refunded_cents)::bigint),0) FROM period_orders WHERE hold_state='released')),
         'payments',${paymentView ? "(SELECT coalesce(jsonb_agg(item ORDER BY created_at DESC,id DESC),'[]'::jsonb) FROM items)" : emptyArray},
         'orders',${paymentView ? emptyArray : "(SELECT coalesce(jsonb_agg(item ORDER BY created_at DESC,id DESC),'[]'::jsonb) FROM items)"}) AS response`,
        [
          from,
          to,
          filters.paymentStatus,
          filters.holdState,
          filters.pageSize,
          (filters.page - 1) * filters.pageSize,
          filters.view,
          filters.page,
        ],
      );
      // Invalid persisted/output data is a departmental failure, rather than
      // a validation error blamed on the operator's submitted filters.
      return parse(
        AdminFinanceResponseSchema,
        result.rows[0]?.response,
        "DEPARTMENT_UNAVAILABLE",
        503,
      );
    });
  },

  async catalog(
    actor: AdminActorContext,
    input: unknown = {},
  ): Promise<AdminCatalogResponse> {
    authorize(actor, "catalog_moderation");
    const filters = parse(AdminCatalogQuerySchema, input);
    // Wildcards entered by the operator are literal search text. No user input
    // is interpolated into SQL, sorting or field names.
    const search =
      "%" + filters.search.replace(/[\\%_]/g, (value) => "\\" + value) + "%";
    const productView = filters.view === "products";
    const storeView = filters.view === "stores";
    const baseProducts = `SELECT p.id,p.title,p.is_published,p.updated_at,p.category_id,p.store_id,p.revision,p.admin_hidden,
      c.name AS category_name,c.is_active AS category_active,s.store_name,s.status AS store_status,
      (p.is_published AND c.is_active AND s.is_visible) AS is_visible
      FROM public.app_products p JOIN public.app_categories c ON c.id=p.category_id
      JOIN store_scope s ON s.id=p.store_id`;
    const filtered = productView
      ? `SELECT * FROM product_scope WHERE (title ILIKE $1 OR store_name ILIKE $1 OR category_name ILIKE $1)
          AND ($2::text='all' OR ($2='published' AND is_published) OR ($2='draft' AND NOT is_published)
            OR ($2='unavailable' AND is_published AND NOT is_visible)) AND ($3::text='all' OR store_status=$3)`
      : storeView
        ? `SELECT id,store_name AS name,store_slug AS slug,status,updated_at,revision,admin_hidden,
            is_visible FROM store_scope
            WHERE (store_name ILIKE $1 OR store_slug ILIKE $1) AND ($3::text='all' OR status=$3)`
        : `SELECT id,name,is_active,updated_at FROM public.app_categories WHERE name ILIKE $1`;
    const item = productView
      ? `jsonb_build_object('id',r.id,'title',r.title,'storeName',r.store_name,'categoryName',r.category_name,
          'isPublished',r.is_published,'isVisible',r.is_visible,'storeStatus',r.store_status,'categoryActive',r.category_active,
          'priceCents',(SELECT price_cents FROM public.app_price_versions WHERE product_id=r.id AND valid_from<=clock_timestamp() ORDER BY valid_from DESC LIMIT 1),
          'updatedAt',r.updated_at,'revision',r.revision,'adminHidden',r.admin_hidden)`
      : storeView
        ? `jsonb_build_object('id',r.id,'name',r.name,'slug',r.slug,'status',r.status,'isVisible',r.is_visible,
            'productCount',(SELECT count(*) FROM public.app_products WHERE store_id=r.id),
            'publishedProductCount',(SELECT count(*) FROM public.app_products WHERE store_id=r.id AND is_published),'updatedAt',r.updated_at,'revision',r.revision,'adminHidden',r.admin_hidden)`
        : `jsonb_build_object('id',r.id,'name',r.name,'isActive',r.is_active,
            'productCount',(SELECT count(*) FROM public.app_products WHERE category_id=r.id),
            'publishedProductCount',(SELECT count(*) FROM public.app_products WHERE category_id=r.id AND is_published))`;
    const list =
      "(SELECT coalesce(jsonb_agg(item ORDER BY updated_at DESC,id DESC),'[]'::jsonb) FROM items)";
    return commerceTransaction(async (client) => {
      await commerceAdmin(client, actor, "catalog_moderation");
      const result = await client.query<{ response: unknown }>(
        `WITH requested_filters AS (SELECT $2::text AS publication,$3::text AS store_status),
       store_scope AS MATERIALIZED (SELECT s.id,s.store_name,s.store_slug,s.status,s.updated_at,s.revision,s.admin_hidden,
         hvm_store_private.store_is_visible(s.id) AS is_visible FROM public.app_producer_stores s),
       product_scope AS MATERIALIZED (${baseProducts}), filtered AS (${filtered}), page_rows AS (
         SELECT * FROM filtered ORDER BY updated_at DESC,id DESC LIMIT $4::int OFFSET $5::int
       ), items AS (SELECT ${item} AS item,r.updated_at,r.id FROM page_rows r)
       SELECT jsonb_build_object('generatedAt',clock_timestamp(),'view',$6::text,
         'pagination',jsonb_build_object('page',$7::int,'pageSize',$4::int,'total',(SELECT count(*) FROM filtered)),
         'metrics',jsonb_build_object('publishedProducts',(SELECT count(*) FROM product_scope WHERE is_published),
           'draftProducts',(SELECT count(*) FROM product_scope WHERE NOT is_published),
           'visibleProducts',(SELECT count(*) FROM product_scope WHERE is_visible),
           'activeStores',(SELECT count(*) FROM public.app_producer_stores WHERE status='active'),
           'activeCategories',(SELECT count(*) FROM public.app_categories WHERE is_active)),
         'products',${productView ? list : emptyArray},'stores',${storeView ? list : emptyArray},
         'categories',${!productView && !storeView ? list : emptyArray}) AS response`,
        [
          search,
          filters.publication,
          filters.storeStatus,
          filters.pageSize,
          (filters.page - 1) * filters.pageSize,
          filters.view,
          filters.page,
        ],
      );
      return parse(
        AdminCatalogResponseSchema,
        result.rows[0]?.response,
        "DEPARTMENT_UNAVAILABLE",
        503,
      );
    });
  },
};
