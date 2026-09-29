import { z } from "zod";
import { CommandIdSchema } from "./profilePrivacy.ts";

export const VerificationRequestStatusSchema = z.enum([
  "pending",
  "claimed",
  "in_review",
  "approved",
  "rejected",
  "escalated",
]);

export const VerificationDecisionSchema = z.enum([
  "approved",
  "rejected",
  "adjustments_required",
]);

export const VerificationFilterSchema = z
  .object({
    tab: z.enum(["pending", "in_review", "decided"]).default("pending"),
  })
  .strict();

export const ClaimVerificationRequestSchema = z
  .object({
    commandId: CommandIdSchema,
  })
  .strict();

export const DecideVerificationRequestSchema = z
  .object({
    commandId: CommandIdSchema,
    decision: VerificationDecisionSchema,
    technicalOpinion: z.string().trim().min(10).max(4000),
    assignedTrustLevel: z.number().int().min(1).max(5),
    checklistEnvironmentalOk: z.boolean(),
    checklistLandTenureOk: z.boolean(),
    checklistWaterQualityOk: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.decision === "approved" &&
      !(
        value.checklistEnvironmentalOk &&
        value.checklistLandTenureOk &&
        value.checklistWaterQualityOk
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Aprovação exige checklist ambiental, fundiário e hídrico.",
        path: ["checklistEnvironmentalOk"],
      });
    }
  });

export type VerificationFilter = z.infer<typeof VerificationFilterSchema>;
export type ClaimVerificationRequest = z.infer<
  typeof ClaimVerificationRequestSchema
>;
export type DecideVerificationRequest = z.infer<
  typeof DecideVerificationRequestSchema
>;
