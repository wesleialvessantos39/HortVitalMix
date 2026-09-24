import { z } from "zod";
import { formatBrazilMobile, formatCpf, normalizeBrazilMobile, onlyDigits } from "../utils/normalization.ts";

export { formatBrazilMobile, formatCpf, normalizeBrazilMobile } from "../utils/normalization.ts";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 70;

export function validCpf(value: string): boolean {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  for (let n = 9; n < 11; n++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Number(value[i]) * (n + 1 - i);
    const d = (sum * 10) % 11;
    if ((d === 10 ? 0 : d) !== Number(value[n])) return false;
  }
  return true;
}

export type PasswordChecks = {
  length: boolean;
  lowercase: boolean;
  uppercase: boolean;
  number: boolean;
  symbol: boolean;
};

export function passwordChecks(value: string): PasswordChecks {
  return {
    length:
      value.length >= PASSWORD_MIN_LENGTH &&
      value.length <= PASSWORD_MAX_LENGTH,
    lowercase: /[a-z]/.test(value),
    uppercase: /[A-Z]/.test(value),
    number: /\d/.test(value),
    symbol: /[^A-Za-z0-9\s]/.test(value),
  };
}

export function isStrongPassword(value: string): boolean {
  return Object.values(passwordChecks(value)).every(Boolean);
}

export const StrongPasswordSchema = z
  .string()
  .min(
    PASSWORD_MIN_LENGTH,
    `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres`,
  )
  .max(
    PASSWORD_MAX_LENGTH,
    `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres`,
  )
  .regex(/[a-z]/, "A senha deve conter letra minúscula")
  .regex(/[A-Z]/, "A senha deve conter letra maiúscula")
  .regex(/\d/, "A senha deve conter número")
  .regex(/[^A-Za-z0-9\s]/, "A senha deve conter símbolo");

const email = z.string().trim().toLowerCase().max(255).pipe(z.email());
const cpf = z
  .string()
  .transform((value) => onlyDigits(value))
  .refine(validCpf, "CPF inválido");
const phone = z
  .string()
  .transform(normalizeBrazilMobile)
  .refine(
    (value) => /^\+55[1-9]\d9\d{8}$/.test(value),
    "Use o formato (00) 00000-0000",
  );

const base = {
  fullName: z.string().trim().min(3).max(255),
  cpf,
  email,
  password: StrongPasswordSchema,
  phone,
};

export const RegisterConsumerSchema = z.object(base).strict();
export const RegisterProducerSchema = z
  .object({
    ...base,
    propertyName: z.string().trim().min(2).max(128),
    activityType: z.enum([
      "hortalicas_folhosas",
      "legumes_picados",
      "frutas",
      "temperos",
      "misto",
    ]),
  })
  .strict();

export const PortalRoleSchema = z.enum([
  "consumer",
  "producer",
  "platform_admin",
  "platform_super_admin",
]);
export type PortalRole = z.infer<typeof PortalRoleSchema>;

export const LoginSchema = z
  .object({
    email,
    password: z.string().min(1).max(128),
    portalRole: PortalRoleSchema,
  })
  .strict();
export const EmailRequestSchema = z.object({ email }).strict();

export const RoleScopedEmailRequestSchema = z
  .object({
    email,
    portalRole: PortalRoleSchema,
  })
  .strict();

export const RoleScopedRecoveryFlowSchema = z
  .object({
    portalRole: PortalRoleSchema,
    flowToken: z.string().min(32).max(256),
  })
  .strict();

export const RoleScopedResetPasswordSchema = z
  .object({
    password: StrongPasswordSchema,
    portalRole: PortalRoleSchema,
    flowToken: z.string().min(32).max(256),
  })
  .strict();

export const SecurityCodeRequestSchema = z
  .object({
    portalRole: PortalRoleSchema,
  })
  .strict();

export const RoleScopedPasswordChangeSchema = z
  .object({
    password: StrongPasswordSchema,
    nonce: z.string().regex(/^\d{6,8}$/, "Código de segurança inválido"),
    challengeId: z.string().uuid(),
    portalRole: PortalRoleSchema,
  })
  .strict();

export const SessionImportSchema = z
  .object({
    accessToken: z.string().min(32).max(8192),
    refreshToken: z.string().min(16).max(4096),
    portalRole: PortalRoleSchema.optional(),
  })
  .strict();
export const NewPasswordSchema = z
  .object({ password: StrongPasswordSchema })
  .strict();
export const PasswordChangeSchema = z
  .object({
    password: StrongPasswordSchema,
    nonce: z.string().regex(/^\d{6,8}$/, "Código de segurança inválido"),
  })
  .strict();

export type Registration = z.infer<typeof RegisterConsumerSchema> &
  Partial<
    Pick<
      z.infer<typeof RegisterProducerSchema>,
      "propertyName" | "activityType"
    >
  >;
