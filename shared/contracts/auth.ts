import { z } from "zod";
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
const email = z.string().trim().toLowerCase().max(255).pipe(z.email());
const base = {
  fullName: z.string().trim().min(3).max(255),
  cpf: z
    .string()
    .transform((v) => v.replace(/[.\-\s]/g, ""))
    .refine(validCpf, "CPF inválido"),
  email,
  password: z.string().min(12).max(128),
  phone: z.string().regex(/^\+[1-9]\d{1,14}$/, "Use o formato +5569999999999"),
};
export const RegisterConsumerSchema = z.object(base).strict();
export const RegisterProducerSchema = z
  .object({
    ...base,
    brandName: z.string().trim().min(2).max(128),
    activityType: z.enum([
      "hortalicas_folhosas",
      "legumes_picados",
      "frutas",
      "temperos",
      "misto",
    ]),
  })
  .strict();
export const LoginSchema = z
  .object({ email, password: z.string().min(1).max(128) })
  .strict();
export const EmailRequestSchema = z.object({ email }).strict();
export const SessionImportSchema = z
  .object({
    accessToken: z.string().min(32).max(8192),
    refreshToken: z.string().min(16).max(4096),
  })
  .strict();
export const NewPasswordSchema = z
  .object({ password: z.string().min(12).max(128) })
  .strict();
export const PasswordChangeSchema = z
  .object({
    password: z.string().min(12).max(128),
    nonce: z.string().regex(/^\d{6,8}$/, "Código de segurança inválido"),
  })
  .strict();
export type Registration = z.infer<typeof RegisterConsumerSchema> &
  Partial<
    Pick<z.infer<typeof RegisterProducerSchema>, "brandName" | "activityType">
  >;
