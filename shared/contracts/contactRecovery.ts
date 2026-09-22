import { z } from "zod";
import { PortalRoleSchema } from "./auth.ts";

export const ContactChannelEnum = z.enum(["email", "phone"]);
export type ContactChannel = z.infer<typeof ContactChannelEnum>;

export const OTPRegex = /^\d{6}$/;

export const RequestChallengeSchema = z.object({
  channel: ContactChannelEnum,
  commandId: z.string().uuid(),
}).strict();
export type RequestChallengeInput = z.infer<typeof RequestChallengeSchema>;

export const ConfirmOtpSchema = z.object({
  channel: ContactChannelEnum,
  otp: z.string().regex(OTPRegex, "Código deve ter exatamente 6 dígitos"),
  commandId: z.string().uuid(),
}).strict();
export type ConfirmOtpInput = z.infer<typeof ConfirmOtpSchema>;

export const ConfirmTokenSchema = z.object({
  token: z.string().min(32).max(128),
}).strict();
export type ConfirmTokenInput = z.infer<typeof ConfirmTokenSchema>;

export const ContactStatusResponseSchema = z.object({
  email: z.object({
    verified: z.boolean(),
    maskedDestination: z.string().nullable(),
    hasActiveChallenge: z.boolean(),
    cooldownRemainingSeconds: z.number().int().min(0),
  }),
  phone: z.object({
    verified: z.boolean(),
    maskedDestination: z.string().nullable(),
    hasActiveChallenge: z.boolean(),
    cooldownRemainingSeconds: z.number().int().min(0),
  }),
});
export type ContactStatusResponse = z.infer<typeof ContactStatusResponseSchema>;

export const RequestPasswordRecoverySchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  commandId: z.string().uuid(),
}).strict();
export type RequestPasswordRecoveryInput = z.infer<typeof RequestPasswordRecoverySchema>;

export const ResetPasswordSchema = z.object({
  token: z.string().min(32).max(128),
  newPassword: z.string()
    .min(10, "Mínimo de 10 caracteres")
    .max(128)
    .regex(/[A-Z]/, "Exige uma letra maiúscula")
    .regex(/[a-z]/, "Exige uma letra minúscula")
    .regex(/[0-9]/, "Exige um número")
    .regex(/[^A-Za-z0-9]/, "Exige um caractere especial"),
}).strict();
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

// Extensão canônica do projeto: preserva o isolamento por portal já homologado
// antes da T04, sem alterar os contratos-base definidos pelo Manual v10.
export const RoleScopedPasswordRecoveryRequestSchema =
  RequestPasswordRecoverySchema.extend({ portalRole: PortalRoleSchema }).strict();
export const RoleScopedPasswordResetSchema =
  ResetPasswordSchema.extend({
    portalRole: PortalRoleSchema,
    flowToken: z.string().min(32).max(256),
  }).strict();

export const ChallengeEmissionResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("issued"),
    channel: ContactChannelEnum,
    maskedDestination: z.string(),
    expiresAt: z.string().datetime(),
    cooldownSeconds: z.number().int().nonnegative(),
  }),
  z.object({ status: z.literal("cooldown"), retryAfterSeconds: z.number().int().positive() }),
  z.object({ status: z.literal("already_verified") }),
  z.object({ status: z.literal("channel_unavailable"), message: z.string() }),
  z.object({ status: z.literal("unavailable"), message: z.string() }),
]);
export type ChallengeEmissionResult = z.infer<typeof ChallengeEmissionResultSchema>;

export const ConfirmationResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("confirmed"), channel: ContactChannelEnum }),
  z.object({ status: z.literal("invalid_code"), attemptsRemaining: z.number().int().nonnegative() }),
  z.object({ status: z.literal("expired") }),
  z.object({ status: z.literal("already_used") }),
  z.object({ status: z.literal("destination_changed") }),
  z.object({ status: z.literal("unavailable") }),
]);
export type ConfirmationResult = z.infer<typeof ConfirmationResultSchema>;

export const PasswordRecoveryRequestResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("accepted"), message: z.string() }),
  z.object({ status: z.literal("rate_limited"), retryAfterSeconds: z.number().int().positive() }),
  z.object({ status: z.literal("unavailable"), message: z.string() }),
]);
export type PasswordRecoveryRequestResult = z.infer<typeof PasswordRecoveryRequestResultSchema>;

export const PasswordResetResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("success") }),
  z.object({ status: z.literal("invalid_token") }),
  z.object({ status: z.literal("expired") }),
  z.object({ status: z.literal("reused_token") }),
  z.object({ status: z.literal("password_reused"), message: z.string() }),
  z.object({ status: z.literal("unavailable"), message: z.string() }),
]);
export type PasswordResetResult = z.infer<typeof PasswordResetResultSchema>;

export const ContactErrorCode = {
  INVALID_CODE: "INVALID_CODE",
  CHALLENGE_EXPIRED: "CHALLENGE_EXPIRED",
  CHALLENGE_ALREADY_USED: "CHALLENGE_ALREADY_USED",
  DESTINATION_CHANGED: "DESTINATION_CHANGED",
  COOLDOWN_ACTIVE: "COOLDOWN_ACTIVE",
  RATE_LIMITED: "RATE_LIMITED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  INVALID_TOKEN: "INVALID_TOKEN",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_REUSED: "TOKEN_REUSED",
  PASSWORD_REUSED: "PASSWORD_REUSED",
  UNAUTHORIZED: "UNAUTHORIZED",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  INTERNAL: "INTERNAL_ERROR",
} as const;
