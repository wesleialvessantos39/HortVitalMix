import {
  KpiCalculationSchema,
  KpiDashboardSchema,
  KpiPeriodSchema,
} from "../../shared/contracts/kpi.ts";
import type { AdminActorContext } from "../middleware/adminSession.ts";
import type { PoolClient } from "pg";
import {
  commerceTransaction,
  commerceAdmin,
  commerceAudit,
  CommerceError,
  type CommerceAudit,
} from "./CommerceSupport.ts";
async function authorize(c: PoolClient, actor: AdminActorContext) {
  if (actor.role !== "platform_super_admin")
    throw new CommerceError("FORBIDDEN", 403);
  await commerceAdmin(c, actor, "platform_configuration");
}
async function calendar(c: PoolClient) {
  return (
    await c.query<{ timezone: string; today: string }>(
      "SELECT timezone,(clock_timestamp() AT TIME ZONE timezone)::date::text AS today FROM public.app_global_config WHERE singleton_guard",
    )
  ).rows[0];
}
export const KpiAggregationService = {
  async calculateDailyKpis(
    referenceDate: string,
    actor: AdminActorContext,
    context: CommerceAudit,
  ) {
    const { referenceDate: date } = KpiCalculationSchema.parse({
      referenceDate,
    });
    return commerceTransaction(async (c) => {
      await authorize(c, actor);
      const cal = await calendar(c);
      if (date > cal.today) throw new CommerceError("KPI_FUTURE_DATE", 422);
      await c.query("SELECT pg_advisory_xact_lock(25,hashtext($1))", [
        "kpi:" + date,
      ]);
      // One statement/snapshot for all metrics. Half-open timezone boundaries
      // keep indexed source timestamps usable, including DST and midnight.
      const rows = (
        await c.query(
          `WITH bounds AS (SELECT $1::date::timestamp AT TIME ZONE $2 AS start_at,($1::date+1)::timestamp AT TIME ZONE $2 AS end_at),
      deliveries AS (SELECT DISTINCT e.order_id FROM public.app_order_events e,bounds b
        WHERE e.to_status='delivered' AND e.occurred_at>=b.start_at AND e.occurred_at<b.end_at
          AND NOT EXISTS(SELECT 1 FROM public.app_order_events old WHERE old.order_id=e.order_id AND old.to_status='delivered' AND old.occurred_at<e.occurred_at)),
      gmv AS (SELECT coalesce(sum(o.total_cents),0)::numeric amount,count(*)::numeric orders,count(DISTINCT o.store_id)::numeric producers
        FROM public.app_orders o JOIN deliveries d ON d.order_id=o.id WHERE o.source='online'),
      quotes AS (SELECT count(*)::numeric total,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM public.app_payment_intents i WHERE i.quote_id=q.id AND i.status IN ('approved','refunded')))::numeric converted
        FROM public.app_checkout_quotes q,bounds b WHERE q.created_at>=b.start_at AND q.created_at<b.end_at),
      billing AS (SELECT coalesce(sum(i.amount_cents),0)::numeric amount FROM public.app_payment_intents i
        WHERE i.billing_cycle_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.app_payment_transactions t,bounds b WHERE t.payment_intent_id=i.id AND t.event_type='approved'
        AND t.processed_at>=b.start_at AND t.processed_at<b.end_at AND NOT EXISTS(SELECT 1 FROM public.app_payment_transactions old WHERE old.payment_intent_id=i.id AND old.event_type='approved' AND old.processed_at<t.processed_at))),
      values_to_write AS (SELECT 'gmv_cents' code,amount value FROM gmv UNION ALL SELECT 'avg_ticket_cents',coalesce(amount/nullif(orders,0),0) FROM gmv
        UNION ALL SELECT 'active_producers',producers FROM gmv UNION ALL SELECT 'delivered_orders',orders FROM gmv
        UNION ALL SELECT 'checkout_quotes',total FROM quotes UNION ALL SELECT 'converted_quotes',converted FROM quotes
        UNION ALL SELECT 'conversion_rate',coalesce(converted*100/nullif(total,0),0) FROM quotes
        UNION ALL SELECT 'subscription_revenue_cents',amount FROM billing)
      INSERT INTO public.app_kpi_metrics(kpi_code,metric_value,reference_date)
      SELECT v.code,round(v.value,2),$1::date FROM values_to_write v JOIN public.app_kpi_definitions d ON d.code=v.code AND d.is_active
      ON CONFLICT(kpi_code,reference_date) DO UPDATE SET metric_value=excluded.metric_value,calculated_at=clock_timestamp()
      RETURNING kpi_code AS code,metric_value::float8 AS value,reference_date::text AS "referenceDate",calculated_at AS "calculatedAt"`,
          [date, cal.timezone],
        )
      ).rows;
      await commerceAudit(
        c,
        actor.userId,
        actor.role,
        "bi.daily_calculated",
        "app_kpi_metrics",
        actor.userId,
        { referenceDate: date, metrics: rows.length },
        context,
      );
      return { referenceDate: date, calculated: rows.length };
    });
  },
  async dashboard(actor: AdminActorContext, input: unknown) {
    const period = KpiPeriodSchema.parse(input);
    return commerceTransaction(async (c) => {
      await authorize(c, actor);
      const cal = await calendar(c);
      const definitions = (
        await c.query(
          `SELECT code,name,formula_description AS "formulaDescription",aggregation_interval AS "aggregationInterval" FROM public.app_kpi_definitions WHERE is_active ORDER BY code`,
        )
      ).rows;
      const metrics = (
        await c.query(
          `SELECT m.kpi_code AS code,m.metric_value::float8 AS value,m.reference_date::text AS "referenceDate",m.calculated_at AS "calculatedAt"
        FROM public.app_kpi_metrics m JOIN public.app_kpi_definitions d ON d.code=m.kpi_code AND d.is_active WHERE m.reference_date BETWEEN $1::date AND $2::date ORDER BY m.reference_date,m.kpi_code`,
          [period.startDate, period.endDate],
        )
      ).rows.map((r) => ({ ...r, calculatedAt: r.calculatedAt.toISOString() }));
      return KpiDashboardSchema.parse({
        ...period,
        ...cal,
        definitions,
        metrics,
      });
    });
  },
};
