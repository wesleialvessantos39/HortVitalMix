import { z } from "zod";
import type { AdminActorContext } from "../middleware/adminSession.ts";
import {
  commerceAdmin,
  commerceAudit,
  commerceCommand,
  commerceTransaction,
  CommerceError,
  type CommerceAudit,
} from "./CommerceSupport.ts";
import { subscriptionViews } from "./SubscriptionService.ts";
import {
  openSubscriptionRefund,
  quoteSubscriptionCancellation,
} from "./SubscriptionRefundService.ts";

const querySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    search: z.string().trim().max(80).default(""),
    status: z
      .enum(["all", "trialing", "active", "paused", "past_due", "cancelled"])
      .default("all"),
    audience: z.enum(["all", "consumer", "producer"]).default("all"),
  })
  .strict();
const cancelSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    note: z.string().trim().min(10).max(2000),
  })
  .strict();
export const AdminSubscriptionService = {
  async list(actor: AdminActorContext, raw: unknown) {
    const input = querySchema.parse(raw);
    return commerceTransaction(async (c) => {
      await commerceAdmin(c, actor, "subscription_management");
      const params = [
        input.status,
        input.audience,
        "%" + input.search.replace(/[\\%_]/g, "\\$&") + "%",
      ];
      const where = `($1='all' OR s.status=$1) AND ($2='all' OR s.plan_snapshot->>'targetAudience'=$2) AND (s.plan_snapshot->>'name' ILIKE $3 ESCAPE '\\' OR s.id::text ILIKE $3 ESCAPE '\\' OR coalesce(pe.full_name,'Conta excluída') ILIKE $3 ESCAPE '\\')`;
      const total = Number(
        (
          await c.query(
            `SELECT count(*) FROM app_subscriptions s LEFT JOIN app_people pe ON pe.id=s.person_id WHERE ${where}`,
            params,
          )
        ).rows[0].count,
      );
      const rows = (
        await c.query(
          `SELECT s.id,s.status,s.revision,s.plan_snapshot,s.user_id,s.account_deleted,s.current_period_end,s.created_at,coalesce(pe.full_name,'Conta excluída') AS holder,(SELECT coalesce(sum(b.amount_cents),0) FROM app_billing_cycles b WHERE b.subscription_id=s.id AND b.status='paid') AS paid FROM app_subscriptions s LEFT JOIN app_people pe ON pe.id=s.person_id WHERE ${where} ORDER BY s.created_at DESC,s.id LIMIT 20 OFFSET $4`,
          [...params, (input.page - 1) * 20],
        )
      ).rows;
      return {
        total,
        page: input.page,
        pageSize: 20,
        subscriptions: rows.map((r) => ({
          id: r.id,
          status: r.status,
          revision: r.revision,
          plan: r.plan_snapshot,
          holder: r.holder,
          accountDeleted: r.account_deleted,
          paidAmountCents: Number(r.paid),
          currentPeriodEnd: new Date(r.current_period_end).toISOString(),
          createdAt: new Date(r.created_at).toISOString(),
        })),
      };
    });
  },
  async detail(actor: AdminActorContext, id: string) {
    z.uuid().parse(id);
    return commerceTransaction(async (c) => {
      await commerceAdmin(c, actor, "subscription_management");
      const s = (
        await c.query("SELECT user_id FROM app_subscriptions WHERE id=$1", [id])
      ).rows[0];
      if (!s) throw new CommerceError("SUBSCRIPTION_NOT_FOUND", 404);
      // Deleted identities retain only restricted accounting records; never resolve
      // their former profile through a new account with the same personal data.
      if (!s.user_id) throw new CommerceError("ACCOUNT_DELETED", 409);
      return {
        subscription: (await subscriptionViews(c, s.user_id, id))[0],
        cancellation: await quoteSubscriptionCancellation(c, s.user_id, id),
      };
    });
  },
  async cancel(
    actor: AdminActorContext,
    id: string,
    raw: unknown,
    command: string,
    context: CommerceAudit,
  ) {
    const input = cancelSchema.parse(raw);
    z.uuid().parse(id);
    return commerceTransaction(async (c) => {
      await commerceAdmin(c, actor, "subscription_management");
      return commerceCommand(
        c,
        actor.userId,
        command,
        "subscription.admin_cancel",
        { id, ...input },
        async () => {
          const s = (
            await c.query(
              "SELECT * FROM app_subscriptions WHERE id=$1 FOR UPDATE",
              [id],
            )
          ).rows[0];
          if (!s) throw new CommerceError("SUBSCRIPTION_NOT_FOUND", 404);
          if (s.revision !== input.expectedRevision)
            throw new CommerceError("REVISION_CONFLICT");
          if (s.status === "cancelled" || !s.user_id)
            throw new CommerceError("SUBSCRIPTION_CANCELLED");
          const quote = await quoteSubscriptionCancellation(c, s.user_id, id);
          await c.query(
            "UPDATE app_subscriptions SET status='cancelled',cancelled_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
            [id],
          );
          await c.query(
            "UPDATE app_recurrence_schedules SET is_active=false WHERE subscription_id=$1",
            [id],
          );
          await c.query(
            "UPDATE app_billing_cycles SET status='failed' WHERE subscription_id=$1 AND status='pending' AND payment_intent_id IS NULL AND payment_creation_state='waiting'",
            [id],
          );
          if (quote.eligibleAmountCents > 0)
            await openSubscriptionRefund(
              c,
              s.user_id,
              id,
              quote.eligibleAmountCents,
              "Cancelamento administrativo: " + input.note.slice(0, 1900),
              context,
              command,
              actor,
            );
          await commerceAudit(
            c,
            actor.userId,
            actor.role,
            "subscription.admin_cancel",
            "app_subscriptions",
            id,
            {
              note: input.note,
              revision: s.revision + 1,
              eligibleAmountCents: quote.eligibleAmountCents,
            },
            context,
            command,
          );
          return {
            cancelled: true,
            eligibleAmountCents: quote.eligibleAmountCents,
          };
        },
      );
    });
  },
};
