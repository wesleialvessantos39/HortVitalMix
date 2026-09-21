import { z } from "zod";

export const BrazilianStatesEnum = z.enum([
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
]);

const PhoneE164 = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/, "Formato E.164 esperado");

export const UpdateGlobalConfigPayloadSchema = z
  .object({
    slogan: z.string().trim().min(5).max(255).optional(),
    defaultMunicipality: z.string().trim().min(2).max(100).optional(),
    defaultState: BrazilianStatesEnum.optional(),
    supportEmail: z.string().trim().toLowerCase().email().max(255).optional(),
    supportPhone: PhoneE164.nullable().optional(),
  })
  .strict();

export const UpdateGlobalConfigSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    commandId: z.string().uuid(),
    payload: UpdateGlobalConfigPayloadSchema,
  })
  .strict();

export type UpdateGlobalConfigInput = z.infer<typeof UpdateGlobalConfigSchema>;

export const GlobalConfigPublicSchema = z
  .object({
    platformName: z.string().min(2),
    slogan: z.string(),
    defaultMunicipality: z.string(),
    defaultState: z.string().length(2),
    currency: z.string().length(3),
    timezone: z.string(),
    supportEmail: z.string().email(),
    supportPhone: z.string().nullable(),
    revision: z.number().int().positive(),
  })
  .strict();

export type GlobalConfigPublic = z.infer<typeof GlobalConfigPublicSchema>;

export const GlobalConfigAdminResponseSchema =
  GlobalConfigPublicSchema.extend({
    updatedAt: z.string().datetime(),
    updatedBy: z.string().uuid().nullable(),
  });

export type GlobalConfigAdminResponse = z.infer<
  typeof GlobalConfigAdminResponseSchema
>;

export const ConfigUpdateResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("success"),
    revision: z.number().int().positive(),
    auditEventId: z.string().uuid(),
  }),
  z.object({
    status: z.literal("conflict"),
    currentRevision: z.number().int().positive(),
  }),
  z.object({
    status: z.literal("idempotent_replay"),
    revision: z.number().int().positive(),
    auditEventId: z.string().uuid(),
  }),
  z.object({
    status: z.literal("idempotent_mismatch"),
    message: z.string(),
  }),
  z.object({
    status: z.literal("no_change"),
    revision: z.number().int().positive(),
  }),
]);

export type ConfigUpdateResult = z.infer<typeof ConfigUpdateResultSchema>;

export const ConfigErrorCode = {
  DB_NOT_CONFIGURED: "DATABASE_NOT_CONFIGURED",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  REAUTH_REQUIRED: "ADMIN_REAUTHENTICATION_REQUIRED",
  ORIGIN_REJECTED: "ORIGIN_REJECTED",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  CONFLICT: "CONFIG_REVISION_CONFLICT",
  COMMAND_ID_MISMATCH: "COMMAND_ID_PAYLOAD_MISMATCH",
  INTERNAL: "INTERNAL_ERROR",
} as const;

export type ConfigErrorCodeType =
  (typeof ConfigErrorCode)[keyof typeof ConfigErrorCode];
