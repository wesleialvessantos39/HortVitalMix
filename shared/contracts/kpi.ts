import { z } from "zod";
export const KpiCodeEnum = z.enum([
  "gmv_cents",
  "avg_ticket_cents",
  "active_producers",
  "delivered_orders",
  "checkout_quotes",
  "converted_quotes",
  "conversion_rate",
  "subscription_revenue_cents",
]);
export const KpiPeriodSchema = z
  .object({ startDate: z.iso.date(), endDate: z.iso.date() })
  .strict()
  .refine(
    (v) =>
      v.endDate >= v.startDate &&
      (Date.parse(v.endDate) - Date.parse(v.startDate)) / 86400000 < 31,
    { message: "Selecione até 31 dias." },
  );
export const KpiCalculationSchema = z
  .object({ referenceDate: z.iso.date() })
  .strict();
export const KpiDashboardSchema = z
  .object({
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    timezone: z.string(),
    today: z.iso.date(),
    definitions: z.array(
      z
        .object({
          code: KpiCodeEnum,
          name: z.string(),
          formulaDescription: z.string(),
          aggregationInterval: z.literal("daily"),
        })
        .strict(),
    ),
    metrics: z.array(
      z
        .object({
          code: KpiCodeEnum,
          value: z.number().nonnegative(),
          referenceDate: z.iso.date(),
          calculatedAt: z.iso.datetime(),
        })
        .strict(),
    ),
  })
  .strict();
export type KpiDashboard = z.infer<typeof KpiDashboardSchema>;
