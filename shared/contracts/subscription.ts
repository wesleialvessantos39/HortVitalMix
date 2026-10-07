import { z } from "zod";
export const SubscriptionStatusEnum = z.enum([
  "trialing",
  "active",
  "paused",
  "past_due",
  "cancelled",
]);
export const BillingPeriodEnum = z.enum(["weekly", "biweekly", "monthly"]);
export const PlanInputSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    name: z.string().trim().min(2).max(128),
    targetAudience: z.enum(["consumer", "producer"]),
    deliveriesPerWeek: z.number().int().min(0).max(7),
    priceCents: z.number().int().min(0).max(2147483647),
    billingPeriod: BillingPeriodEnum,
    description: z.string().trim().min(2).max(2000),
    storeId: z.uuid().nullable(),
    isActive: z.boolean(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.targetAudience === "consumer" &&
      (!v.storeId || v.deliveriesPerWeek < 1)
    )
      c.addIssue({
        code: "custom",
        message: "Escolha a loja e ao menos uma entrega por semana.",
      });
    if (
      v.targetAudience === "producer" &&
      (v.storeId !== null || v.deliveriesPerWeek !== 0)
    )
      c.addIssue({
        code: "custom",
        message: "Plano do produtor não inclui recorrência de cesta.",
      });
  });
export const UpdatePlanSchema = z
  .object({
    plan: PlanInputSchema,
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export const RecurrenceSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    preferredWindowId: z.uuid(),
    basketTemplate: z.array(z.uuid()).min(1).max(50),
  })
  .strict()
  .refine(
    (v) => new Set(v.basketTemplate).size === v.basketTemplate.length,
    "Produtos repetidos na cesta.",
  );
export const CreateSubscriptionSchema = z
  .object({
    planId: z.uuid(),
    deliveryAddressId: z.uuid().optional(),
    recurrence: RecurrenceSchema.optional(),
    additionalRecurrences: z.array(RecurrenceSchema).max(6).optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.additionalRecurrences?.length && !v.recurrence)
      c.addIssue({ code: "custom", message: "Defina a primeira recorrência." });
    const all = [
      ...(v.recurrence ? [v.recurrence] : []),
      ...(v.additionalRecurrences ?? []),
    ];
    if (new Set(all.map((x) => x.dayOfWeek)).size !== all.length)
      c.addIssue({
        code: "custom",
        message: "Escolha dias da semana distintos.",
      });
  });
export const ChangeSubscriptionSchema = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();
export const RunBillingCycleSchema = z
  .object({ cycleIndex: z.number().int().positive().optional() })
  .strict();
export const PlanSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  targetAudience: z.enum(["consumer", "producer"]),
  deliveriesPerWeek: z.number().int(),
  priceCents: z.number().int().nonnegative(),
  billingPeriod: BillingPeriodEnum,
  description: z.string(),
  storeId: z.uuid().nullable(),
  storeName: z.string().nullable(),
  isActive: z.boolean(),
  revision: z.number().int().positive(),
});
export type SubscriptionPlan = z.infer<typeof PlanSchema>;
export type SubscriptionView = {
  id: string;
  plan: SubscriptionPlan;
  status: z.infer<typeof SubscriptionStatusEnum>;
  revision: number;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  pausedAt: string | null;
  pauseUntil: string | null;
  cancelledAt: string | null;
  recurrences: Array<{
    id: string;
    dayOfWeek: number;
    preferredWindowId: string | null;
    window: {
      storeId: string;
      startTime: string;
      endTime: string;
      timezone: string;
    };
    basketTemplate: string[];
    isActive: boolean;
  }>;
  cycles: Array<{
    id: string;
    cycleIndex: number;
    amountCents: number;
    dueDate: string;
    status: "pending" | "paid" | "failed" | "refunded";
    paymentIntentId: string | null;
    paymentCreationState: "waiting" | "requested" | "ready" | "uncertain";
  }>;
};
export type TrialView = {
  startsAt: string;
  endsAt: string;
  isConverted: boolean;
  expired: boolean;
  remainingSeconds: number;
};
export type SubscriptionOptions = {
  windows: Array<{
    id: string;
    storeId: string;
    storeName: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    timezone: string;
  }>;
  products: Array<{ id: string; storeId: string; title: string }>;
};
