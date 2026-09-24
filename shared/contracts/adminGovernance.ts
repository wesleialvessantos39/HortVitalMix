import { z } from "zod";
import {
  StrongPasswordSchema,
  validCpf,
} from "./auth.ts";
import {
  normalizeBrazilMobile,
  onlyDigits,
} from "../utils/normalization.ts";

const email = z.string().trim().toLowerCase().max(255).pipe(z.email());
const cpf = z
  .string()
  .transform(onlyDigits)
  .refine(validCpf, "CPF inválido");
const phone = z
  .string()
  .transform(normalizeBrazilMobile)
  .refine((value) => /^\+55[1-9]\d9\d{8}$/.test(value), "Celular inválido");

export const AdminRoleSchema = z.enum([
  "platform_admin",
  "platform_super_admin",
]);
export type AdminRole = z.infer<typeof AdminRoleSchema>;

export const AdminSectorCodeSchema = z.enum([
  "document_verification",
  "catalog_moderation",
  "finance_ops",
]);
export type AdminSectorCode = z.infer<typeof AdminSectorCodeSchema>;

export const BootstrapStatusResponseSchema = z.object({
  status: z.enum(["open", "closed", "disabled"]),
  reason: z.string().nullable(),
  authorizedEmailHint: z.string().nullable().optional(),
});
export type BootstrapStatusResponse = z.infer<typeof BootstrapStatusResponseSchema>;

export const BootstrapRequestSchema = z
  .object({
    fullName: z.string().trim().min(3).max(255),
    cpf,
    email,
    phone,
    password: StrongPasswordSchema,
    commandId: z.string().uuid(),
  })
  .strict();
export type BootstrapRequestInput = z.infer<typeof BootstrapRequestSchema>;

export const BootstrapResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("completed"), userId: z.string().uuid() }),
  z.object({ status: z.literal("already_closed") }),
  z.object({ status: z.literal("disabled") }),
  z.object({ status: z.literal("email_not_authorized") }),
  z.object({ status: z.literal("identity_conflict"), message: z.string() }),
  z.object({ status: z.literal("validation_failed"), message: z.string() }),
  z.object({ status: z.literal("unavailable") }),
]);
export type BootstrapResult = z.infer<typeof BootstrapResultSchema>;

export const AdminLoginSchema = z
  .object({ email, password: z.string().min(1).max(128) })
  .strict();
export type AdminLoginInput = z.infer<typeof AdminLoginSchema>;

export const AdminSessionPayloadSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive().default(3600),
  role: AdminRoleSchema,
  sectors: z.array(AdminSectorCodeSchema),
});
export type AdminSessionPayload = z.infer<typeof AdminSessionPayloadSchema>;

export const AdminLoginResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("mfa_required"),
    mfaChallengeId: z.string().uuid(),
    maskedDestination: z.string(),
    expiresAt: z.string().datetime(),
  }),
  z.object({ status: z.literal("session_created") }).merge(AdminSessionPayloadSchema),
  z.object({ status: z.literal("invalid_credentials") }),
  z.object({ status: z.literal("account_blocked") }),
  z.object({ status: z.literal("no_admin_role") }),
  z.object({
    status: z.literal("rate_limited"),
    retryAfterSeconds: z.number().int().positive(),
  }),
  z.object({ status: z.literal("unavailable") }),
]);
export type AdminLoginResult = z.infer<typeof AdminLoginResultSchema>;

export const MfaVerifySchema = z
  .object({
    challengeId: z.string().uuid(),
    otp: z.string().regex(/^\d{6}$/, "Código de 6 dígitos"),
  })
  .strict();
export type MfaVerifyInput = z.infer<typeof MfaVerifySchema>;

export const MfaVerifyResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("verified") }).merge(AdminSessionPayloadSchema),
  z.object({
    status: z.literal("invalid_code"),
    attemptsRemaining: z.number().int().nonnegative(),
  }),
  z.object({ status: z.literal("expired") }),
  z.object({ status: z.literal("already_used") }),
  z.object({ status: z.literal("unavailable") }),
]);
export type MfaVerifyResult = z.infer<typeof MfaVerifyResultSchema>;

export const CreateInviteSchema = z
  .object({
    email,
    targetRole: AdminRoleSchema,
    sectors: z.array(AdminSectorCodeSchema).max(10).default([]),
    commandId: z.string().uuid(),
  })
  .strict()
  .refine(
    (data) => data.targetRole !== "platform_admin" || data.sectors.length >= 1,
    { message: "Administrador Setorial precisa de pelo menos 1 setor", path: ["sectors"] },
  )
  .refine(
    (data) => data.targetRole !== "platform_super_admin" || data.sectors.length === 0,
    { message: "Super administrador não recebe setores", path: ["sectors"] },
  );
export type CreateInviteInput = z.infer<typeof CreateInviteSchema>;

export const InviteIdentityModeSchema = z.enum(["new", "existing"]);
export type InviteIdentityMode = z.infer<typeof InviteIdentityModeSchema>;

export const InviteResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  targetRole: AdminRoleSchema,
  identityMode: InviteIdentityModeSchema,
  sectors: z.array(AdminSectorCodeSchema),
  revision: z.number().int().positive(),
  isAccepted: z.boolean(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  invitedBy: z.string().uuid(),
  invalidatedAt: z.string().datetime().nullable(),
});
export type InviteResponse = z.infer<typeof InviteResponseSchema>;

export const ResendInviteSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    commandId: z.string().uuid(),
  })
  .strict();

export const ValidateInviteResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("valid"),
    email: z.string().email(),
    targetRole: AdminRoleSchema,
    identityMode: InviteIdentityModeSchema,
    existingRoles: z.array(z.enum(["consumer", "producer"])),
    sectors: z.array(AdminSectorCodeSchema),
    expiresAt: z.string().datetime(),
  }),
  z.object({ status: z.literal("invalid") }),
  z.object({ status: z.literal("expired") }),
  z.object({ status: z.literal("already_accepted") }),
  z.object({ status: z.literal("invalidated") }),
]);
export type ValidateInviteResponse = z.infer<typeof ValidateInviteResponseSchema>;

export const AcceptInviteSchema = z
  .object({
    token: z.string().min(32).max(128),
    fullName: z.string().trim().min(3).max(255).optional(),
    cpf,
    phone: phone.optional(),
    password: StrongPasswordSchema,
    commandId: z.string().uuid(),
  })
  .strict();
export type AcceptInviteInput = z.infer<typeof AcceptInviteSchema>;

export const AcceptInviteResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("accepted"), userId: z.string().uuid() }),
  z.object({ status: z.literal("invalid_token") }),
  z.object({ status: z.literal("expired") }),
  z.object({ status: z.literal("already_accepted") }),
  z.object({ status: z.literal("identity_conflict"), message: z.string() }),
  z.object({ status: z.literal("validation_failed"), message: z.string() }),
  z.object({ status: z.literal("unavailable") }),
]);
export type AcceptInviteResult = z.infer<typeof AcceptInviteResultSchema>;

export const AdminVerifySessionResponseSchema = z.object({
  authorized: z.boolean(),
  role: AdminRoleSchema.nullable(),
  sectors: z.array(AdminSectorCodeSchema),
  requiresReauth: z.boolean(),
});
export type AdminVerifySessionResponse = z.infer<typeof AdminVerifySessionResponseSchema>;

export const AdminErrorCode = {
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  ACCOUNT_BLOCKED: "ACCOUNT_BLOCKED",
  NO_ADMIN_ROLE: "NO_ADMIN_ROLE",
  MFA_REQUIRED: "MFA_REQUIRED",
  MFA_INVALID: "MFA_INVALID",
  MFA_EXPIRED: "MFA_EXPIRED",
  RATE_LIMITED: "RATE_LIMITED",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  ORIGIN_REJECTED: "ORIGIN_REJECTED",
  REAUTH_REQUIRED: "ADMIN_REAUTHENTICATION_REQUIRED",
  CONFLICT: "ADMIN_REVISION_CONFLICT",
  LAST_SUPER_ADMIN: "LAST_SUPER_ADMIN_PROTECTED",
  INVALID_STATE: "INVALID_STATE",
  UNAVAILABLE: "UNAVAILABLE",
  INTERNAL: "INTERNAL_ERROR",
} as const;
