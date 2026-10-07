import { z } from "zod";
import { RegisterHarvestSchema } from "./inventory.ts";
import { TransitionOrderSchema } from "./order.ts";
import { DeliveryProofSchema } from "./deliveryLogistics.ts";

export const SyncCommandSchema = z
  .object({
    commandId: z.uuid().transform((v) => v.toLowerCase()),
    commandType: z.string().min(1).max(64),
    baseRevision: z.number().int().nonnegative().max(2147483646),
    payload: z
      .record(z.string(), z.unknown())
      .refine((v) => JSON.stringify(v).length <= 4096),
  })
  .strict();
export const ReconcileBatchSchema = z
  .object({
    deviceFingerprint: z
      .string()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
    commands: z
      .array(SyncCommandSchema)
      .min(1)
      .max(50)
      .refine((v) => new Set(v.map((c) => c.commandId)).size === v.length),
  })
  .strict();
export const HarvestSyncPayloadSchema = z
  .object({ productId: z.uuid(), harvest: RegisterHarvestSchema })
  .strict();
export const OrderSyncPayloadSchema = z
  .object({ orderId: z.uuid(), transition: TransitionOrderSchema })
  .strict();
export const ProofSyncPayloadSchema = z
  .object({ orderId: z.uuid(), proof: DeliveryProofSchema })
  .strict();
export const SyncResultSchema = z
  .object({
    commandId: z.uuid(),
    status: z.enum(["confirmed", "conflict", "rejected"]),
    code: z.string(),
    entityId: z.uuid().nullable(),
    revision: z.number().int().nonnegative().nullable(),
    conflictDetails: z
      .object({
        revision: z.number().int().positive(),
        status: z.string().optional(),
        commercialStatus: z.string().optional(),
        title: z.string().optional(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const ReconcileResponseSchema = z
  .object({ results: z.array(SyncResultSchema).max(50) })
  .strict();
export type SyncCommand = z.infer<typeof SyncCommandSchema>;
export type SyncResult = z.infer<typeof SyncResultSchema>;
/** Stable JSON: key order cannot change the meaning of an idempotent command. */
export function canonicalSyncJson(value: unknown): string {
  if (Array.isArray(value))
    return "[" + value.map(canonicalSyncJson).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            canonicalSyncJson((value as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
