import { z } from "zod";

export const FoundationHealthResponseSchema = z
  .object({
    status: z.enum(["ok", "degraded", "unavailable"]),
    requestId: z.uuid(),
    timestamp: z.string(),
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
export const FOUNDATION_SCHEMA_VERSION = 36;
