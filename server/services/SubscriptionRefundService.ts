import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import type { AdminActorContext } from "../middleware/adminSession.ts";
import { getPaymentGateway } from "../payments/gateway.ts";
import {
  commerceAdmin,
  commerceAudit,
  commerceCommand,
  commerceIdentity,
  commerceTransaction,
  CommerceError,
  type CommerceAudit,
} from "./CommerceSupport.ts";
import {
  RequestSubscriptionRefundSchema,
  SubscriptionRefundDecisionSchema,
  SubscriptionRefundPolicySchema,
  SubscriptionRefundQuerySchema,
  UpdateSubscriptionRefundPolicySchema,
  type SubscriptionCancellationQuote,
  type SubscriptionRefundView,
} from "../../shared/contracts/subscriptionRefund.ts";

export async function currentSubscriptionRefundPolicy(c: PoolClient) {
  const row = (
    await c.query(
      "SELECT policy FROM public.app_subscription_refund_policies ORDER BY version DESC LIMIT 1",
    )
  ).rows[0];
  return SubscriptionRefundPolicySchema.parse(row?.policy);
}
export async function quoteSubscriptionCancellation(
  c: PoolClient,
  userId: string,
  id: string,
): Promise<SubscriptionCancellationQuote> {
  const s = (
    await c.query(
      "SELECT * FROM public.app_subscriptions WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [z.uuid().parse(id), userId],
    )
  ).rows[0];
  if (!s) throw new CommerceError("SUBSCRIPTION_NOT_FOUND", 404);
  // Legacy contracts have no commercial snapshot: use the original baseline,
  // never retroactively apply a subsequently edited commercial policy.
  const policy = SubscriptionRefundPolicySchema.parse(
    s.refund_policy_snapshot ??
      (
        await c.query(
          "SELECT policy FROM public.app_subscription_refund_policies WHERE version=1",
        )
      ).rows[0].policy,
  );
  const result = (
    await c.query(
      `SELECT coalesce(sum(p.amount_cents-coalesce((SELECT sum(i.confirmed_amount_cents) FROM public.app_subscription_refund_items i WHERE i.payment_intent_id=p.id),0)),0)::bigint AS available
    FROM public.app_billing_cycles b JOIN public.app_payment_intents p ON p.id=b.payment_intent_id
    WHERE b.subscription_id=$1 AND b.status='paid' AND p.status='approved'`,
      [id],
    )
  ).rows[0];
  const paidAmountCents = Number(result.available);
  const deadline = new Date(
    new Date(s.created_at).getTime() + policy.withdrawalDays * 86400000,
  );
  const within = Date.now() <= deadline.getTime();
  const start = new Date(s.current_period_start).getTime(),
    end = new Date(s.current_period_end).getTime();
  // Prorating only includes the paid current cycle, not historical used periods.
  const currentPaid = Number(
    (
      await c.query(
        `SELECT coalesce(sum(p.amount_cents-coalesce((SELECT sum(i.confirmed_amount_cents) FROM public.app_subscription_refund_items i WHERE i.payment_intent_id=p.id),0)),0)::bigint AS amount
    FROM public.app_billing_cycles b JOIN public.app_payment_intents p ON p.id=b.payment_intent_id WHERE b.subscription_id=$1 AND b.status='paid' AND p.status='approved' AND b.period_start=$2 AND b.period_end=$3`,
        [id, s.current_period_start, s.current_period_end],
      )
    ).rows[0].amount,
  );
  const prorated = Math.floor(
    currentPaid * Math.max(0, Math.min(1, (end - Date.now()) / (end - start))),
  );
  const eligibleAmountCents = within
    ? paidAmountCents
    : policy.prorateUnused
      ? prorated
      : 0;
  return {
    subscriptionId: id,
    revision: s.revision,
    policy,
    paidAmountCents,
    eligibleAmountCents,
    withdrawalDeadline: deadline.toISOString(),
    eligibility: !paidAmountCents
      ? "no_payment"
      : eligibleAmountCents > 0
        ? "eligible"
        : "analysis_required",
    gatewayAvailable: !!getPaymentGateway(),
    explanation: !paidAmountCents
      ? "Não há pagamento confirmado a devolver. O cancelamento impede novos ciclos."
      : eligibleAmountCents > 0
        ? within
          ? "Há valor elegível para análise de devolução no prazo de arrependimento da contratação a distância, quando aplicável. O cancelamento abrirá uma solicitação; aprovação não confirma transferência de dinheiro."
          : "A política contratada prevê devolução proporcional do período pago não utilizado. A solicitação será analisada antes do estorno."
        : "O prazo contratual de arrependimento terminou e este contrato não prevê devolução automática para esse período. Problemas de serviço e outros direitos legais continuam disponíveis para análise em Reembolsos.",
  };
}
async function refundView(
  c: PoolClient,
  id: string,
): Promise<SubscriptionRefundView> {
  const row = (
    await c.query("SELECT * FROM public.app_subscription_refunds WHERE id=$1", [
      id,
    ])
  ).rows[0];
  if (!row) throw new CommerceError("REFUND_NOT_FOUND", 404);
  const history = (
    await c.query(
      "SELECT action,note,created_at FROM (SELECT id,action,note,created_at FROM public.app_subscription_refund_history WHERE refund_id=$1 ORDER BY created_at DESC,id DESC LIMIT 200) recent_history ORDER BY created_at,id",
      [id],
    )
  ).rows;
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    planName: row.plan_snapshot.name,
    audience: row.plan_snapshot.targetAudience,
    status: row.status,
    revision: row.revision,
    requestedAmountCents: row.requested_amount_cents,
    approvedAmountCents: row.approved_amount_cents,
    reason: row.reason,
    createdAt: new Date(row.created_at).toISOString(),
    policy: SubscriptionRefundPolicySchema.parse(row.policy_snapshot),
    history: history.map((r) => ({
      action: r.action,
      note: r.note,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  };
}
async function history(
  c: PoolClient,
  id: string,
  userId: string,
  action: string,
  note: string,
) {
  await c.query(
    "INSERT INTO public.app_subscription_refund_history(refund_id,actor_id,action,note) VALUES($1,$2,$3,$4)",
    [id, userId, action, note],
  );
}
export async function openSubscriptionRefund(
  c: PoolClient,
  userId: string,
  id: string,
  amount: number,
  note: string,
  context: CommerceAudit,
  commandId: string,
  actor?: AdminActorContext,
) {
  const existing = (
    await c.query(
      "SELECT id FROM public.app_subscription_refunds WHERE subscription_id=$1 AND status NOT IN ('rejected','refunded') FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (existing) return refundView(c, existing.id);
  const quote = await quoteSubscriptionCancellation(c, userId, id);
  if (amount < 1 || amount > quote.paidAmountCents || amount > 2147483647)
    throw new CommerceError("REFUND_AMOUNT_INVALID", 422);
  const subscription = (
    await c.query(
      "SELECT plan_snapshot FROM public.app_subscriptions WHERE id=$1",
      [id],
    )
  ).rows[0];
  const created = (
    await c.query(
      "INSERT INTO public.app_subscription_refunds(subscription_id,requester_user_id,plan_snapshot,policy_snapshot,reason,requested_amount_cents) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
      [id, userId, subscription.plan_snapshot, quote.policy, note, amount],
    )
  ).rows[0];
  const cycles = (
    await c.query(
      `SELECT b.id,p.id AS payment_id,p.amount_cents-coalesce((SELECT sum(i.confirmed_amount_cents) FROM public.app_subscription_refund_items i WHERE i.payment_intent_id=p.id),0) AS available
    FROM public.app_billing_cycles b JOIN public.app_payment_intents p ON p.id=b.payment_intent_id WHERE b.subscription_id=$1 AND b.status='paid' AND p.status='approved' ORDER BY b.cycle_index DESC FOR UPDATE OF b,p`,
      [id],
    )
  ).rows;
  let remaining = amount;
  for (const cycle of cycles) {
    const allocation = Math.min(Number(cycle.available), remaining);
    if (allocation <= 0) continue;
    await c.query(
      "INSERT INTO public.app_subscription_refund_items(refund_id,billing_cycle_id,payment_intent_id,amount_cents) VALUES($1,$2,$3,$4)",
      [created.id, cycle.id, cycle.payment_id, allocation],
    );
    remaining -= allocation;
  }
  if (remaining) throw new CommerceError("REFUND_AMOUNT_INVALID", 422);
  await history(c, created.id, actor?.userId ?? userId, "requested", note);
  await commerceAudit(
    c,
    actor?.userId ?? userId,
    actor?.role ?? subscription.plan_snapshot.targetAudience,
    "subscription.refund_requested",
    "app_subscription_refunds",
    created.id,
    { subscriptionId: id, amountCents: amount },
    context,
  );
  return refundView(c, created.id);
}
export const SubscriptionRefundService = {
  async publicPolicy() {
    return commerceTransaction(async (c) => ({
      policy: await currentSubscriptionRefundPolicy(c),
      gatewayAvailable: !!getPaymentGateway(),
    }));
  },
  async adminPolicy(actor: AdminActorContext) {
    return commerceTransaction(async (c) => {
      await commerceAdmin(c, actor, "refund_policy");
      return {
        policy: await currentSubscriptionRefundPolicy(c),
        history: (
          await c.query(
            "SELECT policy,created_at FROM public.app_subscription_refund_policies ORDER BY version DESC LIMIT 50",
          )
        ).rows,
      };
    });
  },
  async savePolicy(
    actor: AdminActorContext,
    raw: unknown,
    command: string,
    context: CommerceAudit,
  ) {
    const input = UpdateSubscriptionRefundPolicySchema.parse(raw);
    return commerceTransaction(async (c) => {
      await commerceAdmin(c, actor, "refund_policy");
      return commerceCommand(
        c,
        actor.userId,
        command,
        "subscription.refund_policy",
        input,
        async () => {
          await c.query(
            "SELECT pg_advisory_xact_lock(hashtext('hvm-subscription-refund-policy'))",
          );
          const current = await currentSubscriptionRefundPolicy(c);
          if (current.version !== input.expectedVersion)
            throw new CommerceError("REVISION_CONFLICT");
          const policy = SubscriptionRefundPolicySchema.parse({
            ...input.policy,
            version: current.version + 1,
          });
          await c.query(
            "INSERT INTO public.app_subscription_refund_policies(version,policy,created_by) VALUES($1,$2,$3)",
            [policy.version, policy, actor.userId],
          );
          await commerceAudit(
            c,
            actor.userId,
            actor.role,
            "subscription.refund_policy_updated",
            "app_subscription_refund_policies",
            actor.userId,
            { version: policy.version },
            context,
            command,
          );
          return { policy };
        },
      );
    });
  },
  async cancellationQuote(userId: string, id: string) {
    return commerceTransaction(async (c) => {
      await commerceIdentity(c, userId);
      return quoteSubscriptionCancellation(c, userId, id);
    });
  },
  async list(userId: string, raw: unknown, actor?: AdminActorContext) {
    const input = SubscriptionRefundQuerySchema.parse(raw);
    return commerceTransaction(async (c) => {
      if (actor) await commerceAdmin(c, actor, "refund_management");
      else await commerceIdentity(c, userId);
      const params = [actor ? null : userId, input.status];
      const total = Number(
        (
          await c.query(
            "SELECT count(*) FROM public.app_subscription_refunds WHERE ($1::uuid IS NULL OR requester_user_id=$1) AND ($2='all' OR status=$2)",
            params,
          )
        ).rows[0].count,
      );
      const rows = (
        await c.query(
          "SELECT id FROM public.app_subscription_refunds WHERE ($1::uuid IS NULL OR requester_user_id=$1) AND ($2='all' OR status=$2) ORDER BY created_at DESC,id LIMIT 20 OFFSET $3",
          [...params, (input.page - 1) * 20],
        )
      ).rows;
      const refunds: SubscriptionRefundView[] = [];
      for (const row of rows) refunds.push(await refundView(c, row.id));
      return {
        refunds,
        total,
        page: input.page,
        pages: Math.max(1, Math.ceil(total / 20)),
        gatewayAvailable: !!getPaymentGateway(),
      };
    });
  },
  async request(
    userId: string,
    raw: unknown,
    command: string,
    context: CommerceAudit,
  ) {
    const input = RequestSubscriptionRefundSchema.parse(raw);
    return commerceTransaction(async (c) => {
      await commerceIdentity(c, userId);
      return commerceCommand(
        c,
        userId,
        command,
        "subscription.refund_request",
        input,
        async () => {
          const quote = await quoteSubscriptionCancellation(
            c,
            userId,
            input.subscriptionId,
          );
          return openSubscriptionRefund(
            c,
            userId,
            input.subscriptionId,
            quote.eligibleAmountCents || quote.paidAmountCents,
            input.note,
            context,
            command,
          );
        },
      );
    });
  },
  async comment(
    userId: string,
    id: string,
    note: string,
    command: string,
    context: CommerceAudit,
    actor?: AdminActorContext,
  ) {
    z.uuid().parse(id);
    z.string().trim().min(10).max(2000).parse(note);
    return commerceTransaction(async (c) => {
      if (actor) await commerceAdmin(c, actor, "refund_management");
      else await commerceIdentity(c, userId);
      return commerceCommand(
        c,
        userId,
        command,
        "subscription.refund_comment",
        { id, note },
        async () => {
          const row = (
            await c.query(
              "SELECT id,status FROM public.app_subscription_refunds WHERE id=$1 AND ($2::uuid IS NULL OR requester_user_id=$2) FOR UPDATE",
              [id, actor ? null : userId],
            )
          ).rows[0];
          if (!row) throw new CommerceError("REFUND_NOT_FOUND", 404);
          if (["refunded", "rejected"].includes(row.status))
            throw new CommerceError("CASE_CLOSED");
          await history(
            c,
            id,
            userId,
            actor ? "admin_message" : "owner_message",
            note,
          );
          await commerceAudit(
            c,
            userId,
            actor?.role ?? "account",
            "subscription.refund_message",
            "app_subscription_refunds",
            id,
            {},
            context,
            command,
          );
          return refundView(c, id);
        },
      );
    });
  },
  async decide(
    actor: AdminActorContext,
    id: string,
    raw: unknown,
    command: string,
    context: CommerceAudit,
  ) {
    z.uuid().parse(id);
    const input = SubscriptionRefundDecisionSchema.parse(raw);
    return commerceTransaction(async (c) => {
      await commerceAdmin(c, actor, "refund_management");
      return commerceCommand(
        c,
        actor.userId,
        command,
        "subscription.refund_decision",
        { id, ...input },
        async () => {
          const row = (
            await c.query(
              "SELECT * FROM public.app_subscription_refunds WHERE id=$1 FOR UPDATE",
              [id],
            )
          ).rows[0];
          if (!row) throw new CommerceError("REFUND_NOT_FOUND", 404);
          if (row.revision !== input.expectedRevision)
            throw new CommerceError("REVISION_CONFLICT");
          if (!["requested", "under_review"].includes(row.status))
            throw new CommerceError("CASE_STATE_CONFLICT");
          const amount =
            input.decision === "approved"
              ? (input.amountCents ?? row.requested_amount_cents)
              : null;
          if (
            amount !== null &&
            (amount < 1 || amount > row.requested_amount_cents)
          )
            throw new CommerceError("REFUND_AMOUNT_INVALID", 422);
          await c.query(
            "UPDATE public.app_subscription_refunds SET status=$2,approved_amount_cents=$3,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
            [id, input.decision, amount],
          );
          await history(c, id, actor.userId, input.decision, input.note);
          await commerceAudit(
            c,
            actor.userId,
            actor.role,
            "subscription.refund_decided",
            "app_subscription_refunds",
            id,
            { decision: input.decision, amountCents: amount },
            context,
            command,
          );
          return refundView(c, id);
        },
      );
    });
  },
  async process(actor: AdminActorContext, id: string, context: CommerceAudit) {
    z.uuid().parse(id);
    const gateway = getPaymentGateway();
    const work = await commerceTransaction(async (c) => {
      await commerceAdmin(c, actor, "refund_management");
      const row = (
        await c.query(
          "SELECT * FROM public.app_subscription_refunds WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!row) throw new CommerceError("REFUND_NOT_FOUND", 404);
      if (row.status === "refunded") return { done: true, items: [] };
      if (!["approved", "processing"].includes(row.status))
        throw new CommerceError("CASE_STATE_CONFLICT");
      if (!gateway) throw new CommerceError("GATEWAY_NOT_CONFIGURED", 503);
      const items = (
        await c.query(
          "SELECT i.*,p.gateway_reference FROM public.app_subscription_refund_items i JOIN public.app_payment_intents p ON p.id=i.payment_intent_id WHERE i.refund_id=$1 ORDER BY i.billing_cycle_id",
          [id],
        )
      ).rows;
      if (items.some((i) => !i.gateway_reference))
        throw new CommerceError("PAYMENT_REFERENCE_MISSING");
      if (row.status === "approved") {
        await c.query(
          "UPDATE public.app_subscription_refunds SET status='processing',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
          [id],
        );
        await history(
          c,
          id,
          actor.userId,
          "processing",
          "Solicitação enviada ao meio de pagamento; devolução ainda não confirmada.",
        );
      }
      let remaining = row.approved_amount_cents;
      return {
        done: false,
        items: items.map((i) => {
          const amount = Math.min(remaining, i.amount_cents);
          remaining -= amount;
          return { ...i, amount };
        }),
      };
    });
    if (work.done) return { status: "refunded" };
    for (const item of work.items) {
      if (item.amount === 0 || item.confirmed_amount_cents >= item.amount)
        continue;
      const result = await gateway!.refund({
        paymentReference: item.gateway_reference,
        refundId: id + ":" + item.billing_cycle_id,
        amountCents: item.amount,
      });
      if (result.status !== "refunded") return { status: "processing" };
      z.string().trim().min(1).max(255).parse(result.reference);
      // Persist a trusted provider fact even if the initiating administrator's
      // permission changes during the external call. Never repeat confirmed items.
      await commerceTransaction(async (c) => {
        const current = (
          await c.query(
            "SELECT * FROM public.app_subscription_refund_items WHERE refund_id=$1 AND billing_cycle_id=$2 FOR UPDATE",
            [id, item.billing_cycle_id],
          )
        ).rows[0];
        if (current.confirmed_amount_cents) {
          if (
            current.confirmed_amount_cents !== item.amount ||
            current.gateway_refund_reference !== result.reference
          )
            throw new CommerceError("REFUND_RECEIPT_CONFLICT");
          return;
        }
        await c.query(
          "UPDATE public.app_subscription_refund_items SET confirmed_amount_cents=$3,gateway_refund_reference=$4 WHERE refund_id=$1 AND billing_cycle_id=$2",
          [id, item.billing_cycle_id, item.amount, result.reference],
        );
        const total = Number(
          (
            await c.query(
              "SELECT sum(confirmed_amount_cents) AS n FROM public.app_subscription_refund_items WHERE payment_intent_id=$1",
              [item.payment_intent_id],
            )
          ).rows[0].n,
        );
        const payment = (
          await c.query(
            "SELECT amount_cents FROM public.app_payment_intents WHERE id=$1 FOR UPDATE",
            [item.payment_intent_id],
          )
        ).rows[0];
        if (total === payment.amount_cents) {
          await c.query(
            "UPDATE public.app_payment_intents SET status='refunded',updated_at=clock_timestamp() WHERE id=$1",
            [item.payment_intent_id],
          );
          await c.query(
            "UPDATE public.app_billing_cycles SET status='refunded' WHERE id=$1",
            [item.billing_cycle_id],
          );
        }
        await commerceAudit(
          c,
          actor.userId,
          actor.role,
          "subscription.refund_item_confirmed",
          "app_subscription_refunds",
          id,
          { amountCents: item.amount, provider: gateway!.provider },
          context,
        );
      });
    }
    return commerceTransaction(async (c) => {
      const row = (
        await c.query(
          "SELECT * FROM public.app_subscription_refunds WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      const paid = Number(
        (
          await c.query(
            "SELECT sum(confirmed_amount_cents) AS n FROM public.app_subscription_refund_items WHERE refund_id=$1",
            [id],
          )
        ).rows[0].n,
      );
      if (paid !== row.approved_amount_cents) return { status: "processing" };
      if (row.status !== "refunded") {
        await c.query(
          "UPDATE public.app_subscription_refunds SET status='refunded',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
          [id],
        );
        await history(
          c,
          id,
          actor.userId,
          "refunded",
          "Devolução confirmada pelo meio de pagamento.",
        );
      }
      return { status: "refunded" };
    });
  },
};
