import { z } from "zod";
import { AdminRoleSchema, AdminSectorCodeSchema } from "./adminGovernance.ts";

const adminActionPath = z.string().regex(/^\/(?:admin(?:\/[^?#]*)?|produtos)?$/);

export const AdminDashboardMetricSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string(),
  value: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  unit: z.enum(["count", "currency_cents", "revision"]),
  note: z.string().optional(),
  attention: z.boolean(),
  actionPath: adminActionPath.optional(),
}).strict();

export const AdminDashboardDepartmentSchema = z.object({
  sector: AdminSectorCodeSchema,
  title: z.string(),
  description: z.string(),
  actionPath: adminActionPath,
  metrics: z.array(AdminDashboardMetricSchema),
}).strict();

export const AdminDashboardResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  refreshAfterSeconds: z.number().int().positive(),
  scope: z.object({ role: AdminRoleSchema, sectors: z.array(AdminSectorCodeSchema) }).strict(),
  departments: z.array(AdminDashboardDepartmentSchema),
}).strict();

export type AdminDashboardMetric = z.infer<typeof AdminDashboardMetricSchema>;
export type AdminDashboardDepartment = z.infer<typeof AdminDashboardDepartmentSchema>;
export type AdminDashboardResponse = z.infer<typeof AdminDashboardResponseSchema>;
