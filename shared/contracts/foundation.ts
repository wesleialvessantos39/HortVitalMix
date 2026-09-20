import { z } from "zod";
export const AppEnvironmentSchema = z.enum([
  "development",
  "homologation",
  "production",
]);
export type AppEnvironment = z.infer<typeof AppEnvironmentSchema>;
export const GlobalConfigPublicSchema = z
  .object({
    platformName: z.string().min(2),
    slogan: z.string(),
    defaultMunicipality: z.string(),
    defaultState: z.string().length(2),
    currency: z.string().length(3),
    timezone: z.string(),
    supportEmail: z.email(),
    supportPhone: z.string().nullable(),
    revision: z.number().int().positive(),
  })
  .strict();
export type GlobalConfigPublic = z.infer<typeof GlobalConfigPublicSchema>;
export const ApiHealthResponseSchema = z
  .object({
    status: z.literal("ok"),
    time: z.iso.datetime(),
    environment: AppEnvironmentSchema,
    requestId: z.uuid(),
  })
  .strict();
export const ApiReadyResponseSchema = z
  .object({
    status: z.enum(["ready", "degraded", "unavailable"]),
    databaseConnected: z.boolean(),
    schemaVersion: z.number().int(),
    releaseTag: z.string(),
    requestId: z.uuid(),
    reason: z.string().optional(),
  })
  .strict();
export const FOUNDATION_SCHEMA_VERSION = 13;
