import type { AdminActorContext } from "../middleware/adminSession.ts";
import { getPaymentGateway } from "../payments/gateway.ts";
import {
  commerceAdmin,
  commerceAudit,
  commerceCommand,
  commerceTransaction,
  CommerceError,
  type CommerceAudit,
} from "./CommerceSupport.ts";
import {
  CatalogModerationSchema,
  FinanceCaseSchema,
  FinanceRegistersQuerySchema,
  type FinanceRegisters,
} from "../../shared/contracts/departmentOperations.ts";

const sources = {
  pos: `SELECT id,code AS reference,store_snapshot->>'name' AS name,status,total_cents AS amount_cents,created_at FROM public.app_pos_sales`,
  subscriptions: `SELECT b.id,'Ciclo '||b.cycle_index AS reference,s.plan_snapshot->>'name' AS name,b.status,b.amount_cents,b.created_at FROM public.app_billing_cycles b JOIN public.app_subscriptions s ON s.id=b.subscription_id`,
  refunds: `SELECT id,'Compra' AS reference,'Reembolso de compra' AS name,status,coalesce(approved_amount_cents,requested_amount_cents) AS amount_cents,created_at FROM public.app_refund_requests UNION ALL SELECT id,'Assinatura',plan_snapshot->>'name',status,coalesce(approved_amount_cents,requested_amount_cents),created_at FROM public.app_subscription_refunds`,
  payments: `SELECT id,CASE WHEN account_deleted THEN 'Conta excluída' WHEN billing_cycle_id IS NOT NULL THEN 'Assinatura' WHEN pos_sale_id IS NOT NULL THEN 'Caixa presencial' ELSE 'Compra online' END AS reference,method AS name,status,amount_cents,created_at FROM public.app_payment_intents`,
  orders: `SELECT id,order_number::text AS reference,store_snapshot->>'name' AS name,status,total_cents AS amount_cents,created_at FROM public.app_orders`,
};
export const DepartmentOperationsService = {
  async moderateCatalog(
    actor: AdminActorContext,
    raw: unknown,
    commandId: string,
    context: CommerceAudit,
  ) {
    const input = CatalogModerationSchema.parse(raw),
      table =
        input.targetType === "product" ? "app_products" : "app_producer_stores";
    return commerceTransaction(async (c) => {
      await commerceAdmin(c, actor, "catalog_moderation");
      return commerceCommand(
        c,
        actor.userId,
        commandId,
        "catalog.moderation",
        input,
        async () => {
          const row = (
            await c.query(
              `SELECT revision,admin_hidden FROM public.${table} WHERE id=$1 FOR UPDATE`,
              [input.targetId],
            )
          ).rows[0];
          if (!row) throw new CommerceError("CATALOG_RECORD_NOT_FOUND", 404);
          if (row.revision !== input.expectedRevision)
            throw new CommerceError("REVISION_CONFLICT");
          const hidden = input.action === "hide";
          if (row.admin_hidden === hidden)
            throw new CommerceError("CATALOG_STATE_CONFLICT");
          await c.query(
            `UPDATE public.${table} SET admin_hidden=$2,revision=revision+1,updated_at=clock_timestamp()${input.targetType === "product" && hidden ? ",is_published=false" : ""} WHERE id=$1`,
            [input.targetId, hidden],
          );
          await c.query(
            "INSERT INTO public.app_catalog_moderation_history(target_type,target_id,actor_id,action,reason) VALUES($1,$2,$3,$4,$5)",
            [
              input.targetType,
              input.targetId,
              actor.userId,
              input.action,
              input.reason,
            ],
          );
          await commerceAudit(
            c,
            actor.userId,
            actor.role,
            "catalog." + input.action,
            table,
            input.targetId,
            { reason: input.reason, revision: row.revision + 1 },
            context,
            commandId,
          );
          return { status: "saved", revision: row.revision + 1 };
        },
      );
    });
  },
  async catalogHistory(
    actor: AdminActorContext,
    id: string,
    type: "product" | "store",
  ) {
    return commerceTransaction(async (c) => {
      await commerceAdmin(c, actor, "catalog_moderation");
      return {
        history: (
          await c.query(
            "SELECT action,reason,created_at FROM public.app_catalog_moderation_history WHERE target_type=$1 AND target_id=$2 ORDER BY created_at DESC LIMIT 100",
            [type, id],
          )
        ).rows,
      };
    });
  },
  async financeRegisters(
    actor: AdminActorContext,
    raw: unknown,
  ): Promise<FinanceRegisters> {
    const input = FinanceRegistersQuerySchema.parse(raw),
      search = "%" + input.search.replace(/[\\%_]/g, (v) => "\\" + v) + "%";
    const to =
      input.to ??
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Cuiaba",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    const from =
      input.from ??
      new Date(Date.parse(to) - 29 * 86400000).toISOString().slice(0, 10);
    FinanceRegistersQuerySchema.parse({ ...input, from, to });
    return commerceTransaction(async (c) => {
      await commerceAdmin(c, actor, "finance_ops");
      const params = [search, from, to, input.view];
      const where =
        "r.created_at>=($2::date::timestamp AT TIME ZONE 'America/Cuiaba') AND r.created_at<(($3::date+1)::timestamp AT TIME ZONE 'America/Cuiaba') AND (coalesce(r.name,'') ILIKE $1 OR r.reference ILIKE $1 OR r.id::text ILIKE $1)";
      const total = Number(
        (
          await c.query(
            `WITH records AS (${sources[input.view]}) SELECT count(*) FROM records r WHERE ${where}`,
            params.slice(0, 3),
          )
        ).rows[0].count,
      );
      const rows = (
        await c.query(
          `WITH records AS (${sources[input.view]}) SELECT r.*,CASE WHEN f.id IS NULL THEN NULL ELSE jsonb_build_object('status',f.status,'note',f.note,'revision',f.revision) END AS "case" FROM records r LEFT JOIN public.app_finance_cases f ON f.target_type=$4 AND f.target_id=r.id WHERE ${where} ORDER BY r.created_at DESC,r.id LIMIT 20 OFFSET $5`,
          [...params, (input.page - 1) * 20],
        )
      ).rows;
      const pendingCases = Number(
        (
          await c.query(
            "SELECT count(*) FROM public.app_finance_cases WHERE status<>'resolved'",
          )
        ).rows[0].count,
      );
      return {
        view: input.view,
        total,
        page: input.page,
        pages: Math.max(1, Math.ceil(total / 20)),
        gatewayAvailable: !!getPaymentGateway(),
        pendingCases,
        rows: rows.map((r) => ({
          id: r.id,
          reference: r.reference,
          name: r.name ?? "Conta excluída",
          status: r.status,
          amountCents: r.amount_cents,
          createdAt: new Date(r.created_at).toISOString(),
          case: r.case,
        })),
      };
    });
  },
  async financeCase(
    actor: AdminActorContext,
    raw: unknown,
    commandId: string,
    context: CommerceAudit,
  ) {
    const input = FinanceCaseSchema.parse(raw);
    return commerceTransaction(async (c) => {
      await commerceAdmin(c, actor, "finance_ops");
      return commerceCommand(
        c,
        actor.userId,
        commandId,
        "finance.case",
        input,
        async () => {
          const target = await c.query(
            `WITH records AS (${sources[input.targetType]}) SELECT 1 FROM records WHERE id=$1`,
            [input.targetId],
          );
          if (!target.rowCount)
            throw new CommerceError("FINANCIAL_RECORD_NOT_FOUND", 404);
          await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            input.targetType + input.targetId,
          ]);
          const current = (
            await c.query(
              "SELECT revision FROM public.app_finance_cases WHERE target_type=$1 AND target_id=$2 FOR UPDATE",
              [input.targetType, input.targetId],
            )
          ).rows[0];
          if ((current?.revision ?? 0) !== input.expectedRevision)
            throw new CommerceError("REVISION_CONFLICT");
          const row = (
            await c.query(
              "INSERT INTO public.app_finance_cases(target_type,target_id,status,note,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(target_type,target_id) DO UPDATE SET status=EXCLUDED.status,note=EXCLUDED.note,updated_by=EXCLUDED.updated_by,revision=app_finance_cases.revision+1,updated_at=clock_timestamp() RETURNING id,revision",
              [
                input.targetType,
                input.targetId,
                input.status,
                input.note,
                actor.userId,
              ],
            )
          ).rows[0];
          await commerceAudit(
            c,
            actor.userId,
            actor.role,
            "finance.case_updated",
            "app_finance_cases",
            row.id,
            { status: input.status, note: input.note, revision: row.revision },
            context,
            commandId,
          );
          return { status: "saved", revision: row.revision };
        },
      );
    });
  },
};
