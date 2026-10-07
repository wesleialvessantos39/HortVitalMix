import { z } from "zod";
import type { PoolClient } from "pg";
import type { AdminActorContext } from "../middleware/adminSession.ts";
import { getPaymentGateway } from "../payments/gateway.ts";
import { PaymentService } from "./PaymentService.ts";
import {
  CommerceError,
  commerceTransaction,
  commerceIdentity,
  commerceAdmin,
  commerceCommand,
  commerceAudit,
  type CommerceAudit,
} from "./CommerceSupport.ts";
import {
  CreateSubscriptionSchema,
  ChangeSubscriptionSchema,
  RunBillingCycleSchema,
  PlanInputSchema,
  UpdatePlanSchema,
  PlanSchema,
  type SubscriptionPlan,
  type SubscriptionView,
  type SubscriptionOptions,
  type TrialView,
} from "../../shared/contracts/subscription.ts";

export function nextSubscriptionPeriod(
  start: Date,
  period: string,
  anchorDay = start.getUTCDate(),
): Date {
  const end = new Date(start);
  if (period !== "monthly")
    end.setUTCDate(end.getUTCDate() + (period === "weekly" ? 7 : 14));
  else {
    end.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const last = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0),
    ).getUTCDate();
    end.setUTCDate(Math.min(anchorDay, last));
  }
  return end;
}
export function subscriptionPlan(row: Record<string, any>): SubscriptionPlan {
  return PlanSchema.parse({
    id: row.id,
    slug: row.slug,
    name: row.name,
    targetAudience: row.target_audience,
    deliveriesPerWeek: row.deliveries_per_week,
    priceCents: row.price_cents,
    billingPeriod: row.billing_period,
    description: row.description,
    storeId: row.store_id,
    storeName: row.store_name ?? null,
    isActive: row.is_active,
    revision: row.revision,
  });
}
const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : null);
async function views(
  c: PoolClient,
  userId: string,
  id?: string,
): Promise<SubscriptionView[]> {
  const rows = (
    await c.query(
      `SELECT * FROM public.app_subscriptions WHERE user_id=$1 ${id ? "AND id=$2" : ""} ORDER BY created_at DESC,id LIMIT 100`,
      id ? [userId, id] : [userId],
    )
  ).rows;
  const ids = rows.map((r) => r.id);
  const schedules = (
    await c.query(
      "SELECT * FROM public.app_recurrence_schedules WHERE subscription_id=ANY($1::uuid[]) ORDER BY day_of_week",
      [ids],
    )
  ).rows;
  const cycles = (
    await c.query(
      "SELECT *,due_date::text AS due_date_text FROM public.app_billing_cycles WHERE subscription_id=ANY($1::uuid[]) ORDER BY cycle_index DESC",
      [ids],
    )
  ).rows;
  return rows.map((r) => ({
    id: r.id,
    plan: PlanSchema.parse(r.plan_snapshot),
    status:
      r.status === "paused" && new Date(r.pause_until).getTime() <= Date.now()
        ? "active"
        : r.status === "trialing" &&
            new Date(r.current_period_end).getTime() <= Date.now()
          ? "past_due"
          : r.status,
    revision: r.revision,
    currentPeriodStart: iso(r.current_period_start)!,
    currentPeriodEnd: iso(r.current_period_end)!,
    pausedAt: iso(r.paused_at),
    pauseUntil: iso(r.pause_until),
    cancelledAt: iso(r.cancelled_at),
    recurrences: schedules
      .filter((s) => s.subscription_id === r.id)
      .map((s) => ({
        id: s.id,
        dayOfWeek: s.day_of_week,
        preferredWindowId: s.preferred_window_id,
        window: s.window_snapshot,
        basketTemplate: s.basket_template,
        isActive:
          s.is_active &&
          r.status !== "cancelled" &&
          !(
            r.status === "paused" &&
            new Date(r.pause_until).getTime() > Date.now()
          ),
      })),
    cycles: cycles
      .filter((s) => s.subscription_id === r.id)
      .map((s) => ({
        id: s.id,
        cycleIndex: s.cycle_index,
        amountCents: s.amount_cents,
        dueDate: s.due_date_text,
        status: s.status,
        paymentIntentId: s.payment_intent_id,
        paymentCreationState: s.payment_creation_state,
      })),
  }));
}
async function owned(c: PoolClient, userId: string, id: string) {
  z.uuid().parse(id);
  const r = (
    await c.query(
      "SELECT * FROM public.app_subscriptions WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [id, userId],
    )
  ).rows[0];
  if (!r) throw new CommerceError("SUBSCRIPTION_NOT_FOUND", 404);
  return r;
}
async function producer(c: PoolClient, userId: string) {
  const actor = await commerceIdentity(c, userId);
  if (!actor.roles.includes("producer"))
    throw new CommerceError("PRODUCER_REQUIRED", 403);
  const row = (
    await c.query(
      "SELECT id FROM public.app_producer_profiles WHERE person_id=$1",
      [actor.person_id],
    )
  ).rows[0];
  if (!row) throw new CommerceError("PRODUCER_REQUIRED", 403);
  return row.id as string;
}
function trialView(row: Record<string, any> | undefined): TrialView | null {
  if (!row) return null;
  const seconds = Math.max(
    0,
    Math.floor((new Date(row.ends_at).getTime() - Date.now()) / 1000),
  );
  return {
    startsAt: iso(row.starts_at)!,
    endsAt: iso(row.ends_at)!,
    isConverted: row.is_converted,
    expired: seconds === 0,
    remainingSeconds: seconds,
  };
}
export const SubscriptionService = {
  async publicPlans(audience: "consumer" | "producer") {
    return commerceTransaction(async (c) => ({
      plans: (
        await c.query(
          `SELECT p.*,s.store_name FROM public.app_plans p LEFT JOIN public.app_producer_stores s ON s.id=p.store_id WHERE p.is_active AND p.target_audience=$1 AND (p.target_audience='producer' OR hvm_store_private.store_is_visible(p.store_id)) ORDER BY p.price_cents,p.name,p.id`,
          [audience],
        )
      ).rows.map(subscriptionPlan),
      gatewayAvailable: !!getPaymentGateway(),
    }));
  },
  async options(storeId: string): Promise<SubscriptionOptions> {
    z.uuid().parse(storeId);
    return commerceTransaction(async (c) => ({
      windows: (
        await c.query(
          `SELECT w.*,s.store_name FROM public.app_delivery_windows w JOIN public.app_producer_stores s ON s.id=w.store_id WHERE w.store_id=$1 AND w.is_active AND hvm_store_private.store_is_visible(s.id) ORDER BY w.day_of_week,w.start_time`,
          [storeId],
        )
      ).rows.map((w) => ({
        id: w.id,
        storeId: w.store_id,
        storeName: w.store_name,
        dayOfWeek: w.day_of_week,
        startTime: w.start_time.slice(0, 5),
        endTime: w.end_time.slice(0, 5),
        timezone: w.timezone,
      })),
      products: (
        await c.query(
          `SELECT p.id,p.store_id,p.title FROM public.app_products p JOIN public.app_categories cat ON cat.id=p.category_id WHERE p.store_id=$1 AND p.is_published AND cat.is_active AND hvm_store_private.store_is_visible(p.store_id) AND EXISTS(SELECT 1 FROM public.app_price_versions v WHERE v.product_id=p.id AND v.valid_from<=clock_timestamp()) ORDER BY p.title,p.id LIMIT 500`,
          [storeId],
        )
      ).rows.map((p) => ({ id: p.id, storeId: p.store_id, title: p.title })),
    }));
  },
  async mine(userId: string) {
    return commerceTransaction(async (c) => {
      await commerceIdentity(c, userId);
      return {
        subscriptions: await views(c, userId),
        gatewayAvailable: !!getPaymentGateway(),
      };
    });
  },
  async producerTrial(userId: string) {
    return commerceTransaction(async (c) => {
      const id = await producer(c, userId);
      return {
        trial: trialView(
          (
            await c.query(
              "SELECT starts_at,ends_at,is_converted FROM public.app_trial_grants WHERE producer_profile_id=$1",
              [id],
            )
          ).rows[0],
        ),
      };
    });
  },
  async grantProducerTrial(profileId: string, userId: string) {
    return commerceTransaction(async (c) => {
      if (z.uuid().parse(profileId) !== (await producer(c, userId)))
        throw new CommerceError("FORBIDDEN", 403);
      await c.query("SELECT hvm_subscription_private.grant_trial($1)", [
        profileId,
      ]);
      return {
        trial: trialView(
          (
            await c.query(
              "SELECT starts_at,ends_at,is_converted FROM public.app_trial_grants WHERE producer_profile_id=$1",
              [profileId],
            )
          ).rows[0],
        ),
      };
    });
  },
  async createSubscription(
    userId: string,
    raw: unknown,
    commandId: string,
    context: CommerceAudit,
  ) {
    const input = CreateSubscriptionSchema.parse(raw);
    return commerceTransaction(async (c) => {
      const actor = await commerceIdentity(c, userId);
      return commerceCommand(
        c,
        userId,
        commandId,
        "subscription.create",
        input,
        async () => {
          const row = (
            await c.query(
              `SELECT p.*,s.store_name FROM public.app_plans p LEFT JOIN public.app_producer_stores s ON s.id=p.store_id WHERE p.id=$1 AND p.is_active FOR SHARE OF p`,
              [input.planId],
            )
          ).rows[0];
          if (!row) throw new CommerceError("PLAN_UNAVAILABLE", 409);
          const plan = subscriptionPlan(row),
            schedules = [
              ...(input.recurrence ? [input.recurrence] : []),
              ...(input.additionalRecurrences ?? []),
            ];
          let address: Record<string, any> | null = null,
            profile: string | null = null,
            trial: Record<string, any> | undefined;
          if (plan.targetAudience === "consumer") {
            if (!actor.roles.includes("consumer"))
              throw new CommerceError("CONSUMER_REQUIRED", 403);
            if (
              !input.deliveryAddressId ||
              schedules.length !== plan.deliveriesPerWeek ||
              !plan.storeId
            )
              throw new CommerceError("RECURRENCE_REQUIRED", 422);
            address = (
              await c.query(
                "SELECT id,label,cep,street,number,complement,neighborhood,city,state,latitude,longitude,delivery_notes,revision FROM public.app_user_addresses WHERE id=$1 AND person_id=$2 AND is_active FOR SHARE",
                [input.deliveryAddressId, actor.person_id],
              )
            ).rows[0];
            if (
              !address ||
              address.latitude === null ||
              address.longitude === null
            )
              throw new CommerceError("ADDRESS_UNAVAILABLE", 422);
          } else {
            if (input.deliveryAddressId || schedules.length)
              throw new CommerceError("VALIDATION_ERROR", 422);
            profile = await producer(c, userId);
            trial = (
              await c.query(
                "SELECT * FROM public.app_trial_grants WHERE producer_profile_id=$1",
                [profile],
              )
            ).rows[0];
          }
          const windows = [];
          for (const s of [...schedules].sort((a, b) =>
            a.preferredWindowId.localeCompare(b.preferredWindowId),
          )) {
            const w = (
              await c.query(
                `SELECT * FROM public.app_delivery_windows WHERE id=$1 AND store_id=$2 AND day_of_week=$3 AND is_active AND hvm_store_private.store_is_visible(store_id) FOR SHARE`,
                [s.preferredWindowId, plan.storeId, s.dayOfWeek],
              )
            ).rows[0];
            if (!w) throw new CommerceError("WINDOW_UNAVAILABLE", 422);
            const products = (
              await c.query(
                `SELECT p.id FROM public.app_products p JOIN public.app_categories cat ON cat.id=p.category_id WHERE p.id=ANY($1::uuid[]) AND p.store_id=$2 AND p.is_published AND cat.is_active AND EXISTS(SELECT 1 FROM public.app_price_versions v WHERE v.product_id=p.id AND v.valid_from<=clock_timestamp()) FOR SHARE OF p,cat`,
                [s.basketTemplate, plan.storeId],
              )
            ).rows;
            if (products.length !== s.basketTemplate.length)
              throw new CommerceError("BASKET_UNAVAILABLE", 422);
            windows.push({ s, w });
          }
          const now = new Date(),
            trialing =
              plan.priceCents > 0 &&
              trial &&
              !trial.is_converted &&
              new Date(trial.ends_at) > now;
          const start = trialing ? new Date(trial!.starts_at) : now,
            end = trialing
              ? new Date(trial!.ends_at)
              : nextSubscriptionPeriod(start, plan.billingPeriod);
          const created = (
            await c.query(
              `INSERT INTO public.app_subscriptions(user_id,person_id,plan_id,plan_snapshot,producer_profile_id,status,delivery_address_id,delivery_address_snapshot,current_period_start,current_period_end) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
              [
                userId,
                actor.person_id,
                plan.id,
                JSON.stringify(plan),
                profile,
                trialing
                  ? "trialing"
                  : plan.priceCents === 0
                    ? "active"
                    : "past_due",
                input.deliveryAddressId ?? null,
                address ? JSON.stringify(address) : null,
                start,
                end,
              ],
            )
          ).rows[0];
          for (const { s, w } of windows)
            await c.query(
              `INSERT INTO public.app_recurrence_schedules(subscription_id,day_of_week,preferred_window_id,window_snapshot,basket_template) VALUES($1,$2,$3,$4,$5)`,
              [
                created.id,
                s.dayOfWeek,
                w.id,
                JSON.stringify({
                  storeId: w.store_id,
                  startTime: w.start_time.slice(0, 5),
                  endTime: w.end_time.slice(0, 5),
                  timezone: w.timezone,
                }),
                JSON.stringify(s.basketTemplate),
              ],
            );
          await commerceAudit(
            c,
            userId,
            plan.targetAudience,
            "subscription.created",
            "app_subscriptions",
            created.id,
            {
              planId: plan.id,
              status: trialing
                ? "trialing"
                : plan.priceCents === 0
                  ? "active"
                  : "past_due",
            },
            context,
            commandId,
          );
          return (await views(c, userId, created.id))[0];
        },
      );
    });
  },
  async changeSubscription(
    userId: string,
    id: string,
    action: "pause" | "resume" | "cancel",
    raw: unknown,
    commandId: string,
    context: CommerceAudit,
  ) {
    const input = ChangeSubscriptionSchema.parse(raw);
    return commerceTransaction(async (c) => {
      await commerceIdentity(c, userId);
      return commerceCommand(
        c,
        userId,
        commandId,
        "subscription." + action,
        { id, ...input },
        async () => {
          const r = await owned(c, userId, id),
            now = new Date(),
            ended = r.pause_until && new Date(r.pause_until) <= now;
          if (r.revision !== input.expectedRevision)
            throw new CommerceError("REVISION_CONFLICT");
          if (r.status === "cancelled")
            throw new CommerceError("SUBSCRIPTION_CANCELLED");
          if (action === "pause") {
            if (r.status !== "active" && !(r.status === "paused" && ended))
              throw new CommerceError("SUBSCRIPTION_NOT_ACTIVE");
            if (r.paused_at && !ended)
              throw new CommerceError("PAUSE_ALREADY_USED");
            await c.query(
              "UPDATE public.app_subscriptions SET status='paused',paused_at=$2,pause_until=$2::timestamptz+interval '14 days',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
              [id, now],
            );
          } else if (action === "resume") {
            if (r.status !== "paused")
              throw new CommerceError("SUBSCRIPTION_NOT_PAUSED");
            await c.query(
              "UPDATE public.app_subscriptions SET status='active',paused_at=CASE WHEN pause_until<=clock_timestamp() THEN NULL ELSE paused_at END,pause_until=CASE WHEN pause_until<=clock_timestamp() THEN NULL ELSE pause_until END,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
              [id],
            );
          } else {
            await c.query(
              "UPDATE public.app_subscriptions SET status='cancelled',cancelled_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
              [id],
            );
            await c.query(
              "UPDATE public.app_recurrence_schedules SET is_active=false WHERE subscription_id=$1",
              [id],
            );
          }
          await commerceAudit(
            c,
            userId,
            r.plan_snapshot.targetAudience,
            "subscription." + action,
            "app_subscriptions",
            id,
            { revision: r.revision + 1 },
            context,
            commandId,
          );
          return (await views(c, userId, id))[0];
        },
      );
    });
  },
  async pauseSubscription(
    id: string,
    userId: string,
    raw: unknown,
    commandId: string,
    context: CommerceAudit,
  ) {
    return this.changeSubscription(
      userId,
      id,
      "pause",
      raw,
      commandId,
      context,
    );
  },
  async runBillingCycle(
    id: string,
    userId: string,
    raw: unknown,
    commandId: string,
    context: CommerceAudit,
  ) {
    const input = RunBillingCycleSchema.parse(raw);
    const cycle = await commerceTransaction(async (c) => {
      await commerceIdentity(c, userId);
      return commerceCommand(
        c,
        userId,
        commandId,
        "subscription.bill",
        { id, ...input },
        async () => {
          const r = await owned(c, userId, id),
            now = new Date();
          if (r.status === "cancelled")
            throw new CommerceError("SUBSCRIPTION_CANCELLED");
          const plan = PlanSchema.parse(r.plan_snapshot),
            last = (
              await c.query(
                "SELECT * FROM public.app_billing_cycles WHERE subscription_id=$1 AND cycle_index=$2",
                [id, r.last_cycle_index],
              )
            ).rows[0];
          if (input.cycleIndex && input.cycleIndex <= r.last_cycle_index) {
            const prior = (
              await c.query(
                "SELECT id,status,amount_cents FROM public.app_billing_cycles WHERE subscription_id=$1 AND cycle_index=$2",
                [id, input.cycleIndex],
              )
            ).rows[0];
            if (!prior) throw new CommerceError("INVALID_CYCLE", 422);
            return prior;
          }
          if (
            last &&
            (last.status !== "paid" || new Date(r.current_period_end) > now)
          )
            return {
              id: last.id,
              status: last.status,
              amount_cents: last.amount_cents,
            };
          if (r.status === "trialing" && new Date(r.current_period_end) > now)
            throw new CommerceError("BILLING_NOT_DUE", 409);
          const index = r.last_cycle_index + 1;
          if (input.cycleIndex && input.cycleIndex !== index)
            throw new CommerceError("INVALID_CYCLE", 422);
          if (plan.priceCents > 0 && !getPaymentGateway())
            throw new CommerceError("GATEWAY_NOT_CONFIGURED", 503);
          const start =
            r.last_cycle_index > 0 || r.status === "trialing"
              ? new Date(r.current_period_end)
              : now;
          const first = (
            await c.query(
              "SELECT period_start FROM public.app_billing_cycles WHERE subscription_id=$1 AND cycle_index=1",
              [id],
            )
          ).rows[0];
          const end = nextSubscriptionPeriod(
            start,
            plan.billingPeriod,
            first
              ? new Date(first.period_start).getUTCDate()
              : start.getUTCDate(),
          );
          const cycle = (
            await c.query(
              `INSERT INTO public.app_billing_cycles(subscription_id,cycle_index,amount_cents,due_date,period_start,period_end,status) VALUES($1,$2,$3,($4::timestamptz AT TIME ZONE (SELECT timezone FROM public.app_global_config WHERE singleton_guard))::date,$4,$5,$6) RETURNING id,status,amount_cents`,
              [
                id,
                index,
                plan.priceCents,
                start,
                end,
                plan.priceCents === 0 ? "paid" : "pending",
              ],
            )
          ).rows[0];
          await c.query(
            `UPDATE public.app_subscriptions SET last_cycle_index=$2,status=CASE WHEN $3::boolean THEN CASE WHEN status='paused' AND pause_until>clock_timestamp() THEN 'paused' ELSE 'active' END ELSE CASE WHEN status='paused' AND pause_until>clock_timestamp() THEN 'paused' ELSE 'past_due' END END,current_period_start=$4,current_period_end=$5,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1`,
            [id, index, plan.priceCents === 0, start, end],
          );
          await commerceAudit(
            c,
            userId,
            plan.targetAudience,
            "subscription.cycle_created",
            "app_billing_cycles",
            cycle.id,
            { cycleIndex: index, amountCents: plan.priceCents },
            context,
            commandId,
          );
          return cycle;
        },
      );
    });
    const payment =
      cycle.amount_cents > 0 && cycle.status === "pending"
        ? await PaymentService.createPixIntent(userId, cycle.id, context)
        : null;
    return {
      cycleId: cycle.id,
      payment,
      subscription: await commerceTransaction(async (c) => {
        await commerceIdentity(c, userId);
        return (await views(c, userId, id))[0];
      }),
    };
  },
  async adminPlans(actor: AdminActorContext) {
    return commerceTransaction(async (c) => {
      await commerceAdmin(c, actor, "payment_configuration");
      return {
        plans: (
          await c.query(
            "SELECT p.*,s.store_name FROM public.app_plans p LEFT JOIN public.app_producer_stores s ON s.id=p.store_id ORDER BY p.created_at DESC,p.id",
          )
        ).rows.map(subscriptionPlan),
        stores: (
          await c.query(
            "SELECT id,store_name AS name FROM public.app_producer_stores WHERE hvm_store_private.store_is_visible(id) ORDER BY store_name,id",
          )
        ).rows,
        gatewayAvailable: !!getPaymentGateway(),
      };
    });
  },
  async savePlan(
    actor: AdminActorContext,
    id: string | null,
    raw: unknown,
    commandId: string,
    context: CommerceAudit,
  ) {
    const update = id ? UpdatePlanSchema.parse(raw) : null,
      input = update?.plan ?? PlanInputSchema.parse(raw);
    if (id) z.uuid().parse(id);
    return commerceTransaction(async (c) => {
      await commerceAdmin(c, actor, "payment_configuration");
      return commerceCommand(
        c,
        actor.userId,
        commandId,
        "subscription.plan_save",
        { id, ...input, expectedRevision: update?.expectedRevision ?? null },
        async () => {
          if (
            input.storeId &&
            input.isActive &&
            !(
              await c.query(
                "SELECT 1 FROM public.app_producer_stores WHERE id=$1 AND hvm_store_private.store_is_visible(id) FOR SHARE",
                [input.storeId],
              )
            ).rowCount
          )
            throw new CommerceError("STORE_UNAVAILABLE", 422);
          if (id) {
            const old = (
              await c.query(
                "SELECT revision FROM public.app_plans WHERE id=$1 FOR UPDATE",
                [id],
              )
            ).rows[0];
            if (!old) throw new CommerceError("PLAN_NOT_FOUND", 404);
            if (old.revision !== update!.expectedRevision)
              throw new CommerceError("REVISION_CONFLICT");
          }
          const values = [
            input.slug,
            input.name,
            input.targetAudience,
            input.deliveriesPerWeek,
            input.priceCents,
            input.billingPeriod,
            input.description,
            input.storeId,
            input.isActive,
          ];
          const row = id
            ? (
                await c.query(
                  "UPDATE public.app_plans SET slug=$1,name=$2,target_audience=$3,deliveries_per_week=$4,price_cents=$5,billing_period=$6,description=$7,store_id=$8,is_active=$9,revision=revision+1,updated_at=clock_timestamp() WHERE id=$10 RETURNING *",
                  [...values, id],
                )
              ).rows[0]
            : (
                await c.query(
                  "INSERT INTO public.app_plans(slug,name,target_audience,deliveries_per_week,price_cents,billing_period,description,store_id,is_active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
                  values,
                )
              ).rows[0];
          const store = row.store_id
            ? (
                await c.query(
                  "SELECT store_name FROM public.app_producer_stores WHERE id=$1",
                  [row.store_id],
                )
              ).rows[0]
            : null;
          await commerceAudit(
            c,
            actor.userId,
            actor.role,
            "subscription.plan_saved",
            "app_plans",
            row.id,
            {
              isActive: row.is_active,
              priceCents: row.price_cents,
              revision: row.revision,
            },
            context,
            commandId,
          );
          return subscriptionPlan({ ...row, store_name: store?.store_name });
        },
      );
    });
  },
};
