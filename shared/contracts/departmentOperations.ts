import { z } from "zod";
export const CatalogModerationSchema = z
  .object({
    targetType: z.enum(["product", "store"]),
    targetId: z.uuid(),
    action: z.enum(["hide", "release"]),
    expectedRevision: z.number().int().positive(),
    reason: z.string().trim().min(10).max(2000),
  })
  .strict();
export const FinanceRegistersQuerySchema = z
  .object({
    view: z
      .enum(["pos", "subscriptions", "refunds", "payments", "orders"])
      .default("pos"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    search: z.string().trim().max(80).default(""),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict()
  .superRefine((v, c) => {
    for (const key of ["from", "to"] as const) {
      const value = v[key];
      if (
        value &&
        (!Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value)
      )
        c.addIssue({ code: "custom", path: [key], message: "Data inválida" });
    }
    if (
      v.from &&
      v.to &&
      (v.from > v.to || Date.parse(v.to) - Date.parse(v.from) > 365 * 86400000)
    )
      c.addIssue({
        code: "custom",
        path: ["to"],
        message: "Consulte um período válido de até 366 dias",
      });
  });
export const FinanceCaseSchema = z
  .object({
    targetType: z.enum([
      "pos",
      "subscriptions",
      "refunds",
      "payments",
      "orders",
    ]),
    targetId: z.uuid(),
    status: z.enum(["open", "in_review", "resolved"]),
    note: z.string().trim().min(10).max(2000),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export type FinanceRegister = {
  id: string;
  reference: string;
  name: string;
  status: string;
  amountCents: number;
  createdAt: string;
  case: { status: string; note: string; revision: number } | null;
};
export type FinanceRegisters = {
  view: z.infer<typeof FinanceRegistersQuerySchema>["view"];
  rows: FinanceRegister[];
  total: number;
  page: number;
  pages: number;
  gatewayAvailable: boolean;
  pendingCases: number;
};
export const FinanceRegistersResponseSchema = z
  .object({
    view: z.enum(["pos", "subscriptions", "refunds", "payments", "orders"]),
    rows: z
      .array(
        z
          .object({
            id: z.uuid(),
            reference: z.string(),
            name: z.string(),
            status: z.string(),
            amountCents: z.number().int().nonnegative(),
            createdAt: z.iso.datetime(),
            case: z
              .object({
                status: z.enum(["open", "in_review", "resolved"]),
                note: z.string(),
                revision: z.number().int().positive(),
              })
              .strict()
              .nullable(),
          })
          .strict(),
      )
      .max(20),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pages: z.number().int().positive(),
    gatewayAvailable: z.boolean(),
    pendingCases: z.number().int().nonnegative(),
  })
  .strict();
