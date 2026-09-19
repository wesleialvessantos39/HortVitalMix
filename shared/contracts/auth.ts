import { z } from 'zod';

export function normalizeCPF(value: string): string { return value.replace(/\D/g, ''); }
export function isValidCPF(value: string): boolean {
  const cpf = normalizeCPF(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (size: number) => {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Number(cpf[i]) * (size + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

export const ActivityTypeSchema = z.enum(['hortalicas_folhosas', 'legumes_picados', 'frutas', 'temperos', 'misto']);
export const RegisterProducerSchema = z.object({
  fullName: z.string().trim().min(3).max(255),
  cpf: z.string().transform(normalizeCPF).refine(isValidCPF, 'CPF inválido'),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().regex(/^\+[1-9]\d{1,14}$/),
  password: z.string().min(10).max(128),
  brandName: z.string().trim().min(2).max(128),
  activityType: ActivityTypeSchema,
}).strict();
export type RegisterProducerInput = z.infer<typeof RegisterProducerSchema>;
