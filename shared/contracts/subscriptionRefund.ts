import { z } from "zod";

export const SubscriptionRefundPolicySchema = z
  .object({
    version: z.number().int().positive(),
    withdrawalDays: z.number().int().min(7).max(60),
    prorateUnused: z.boolean(),
    additionalTerms: z.string().trim().max(4000),
  })
  .strict();
export const UpdateSubscriptionRefundPolicySchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    policy: SubscriptionRefundPolicySchema.omit({ version: true }),
  })
  .strict();
export const SubscriptionRefundDecisionSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    decision: z.enum(["approved", "rejected", "under_review"]),
    amountCents: z.number().int().nonnegative().max(2147483647).optional(),
    note: z.string().trim().min(10).max(2000),
  })
  .strict();
export const RequestSubscriptionRefundSchema = z
  .object({
    subscriptionId: z.uuid(),
    note: z.string().trim().min(10).max(2000),
  })
  .strict();
export const SubscriptionRefundQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    status: z
      .enum([
        "all",
        "requested",
        "under_review",
        "approved",
        "processing",
        "refunded",
        "rejected",
      ])
      .default("all"),
  })
  .strict();
export type SubscriptionRefundPolicy = z.infer<
  typeof SubscriptionRefundPolicySchema
>;
export type SubscriptionCancellationQuote = {
  subscriptionId: string;
  revision: number;
  policy: SubscriptionRefundPolicy;
  eligibility: "eligible" | "analysis_required" | "no_payment";
  eligibleAmountCents: number;
  paidAmountCents: number;
  withdrawalDeadline: string;
  explanation: string;
  gatewayAvailable: boolean;
};
export type SubscriptionRefundView = {
  id: string;
  subscriptionId: string;
  planName: string;
  audience: "consumer" | "producer";
  status:
    | "requested"
    | "under_review"
    | "approved"
    | "processing"
    | "refunded"
    | "rejected";
  revision: number;
  requestedAmountCents: number;
  approvedAmountCents: number | null;
  reason: string;
  createdAt: string;
  policy: SubscriptionRefundPolicy;
  history: Array<{ action: string; note: string; createdAt: string }>;
};
