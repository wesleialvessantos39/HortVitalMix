import { z } from "zod";
const id = z.uuid().transform((v) => v.toLowerCase());
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const ScheduledDateSchema = z.iso.date();
export const DeliveryWindowSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: time,
    endTime: time,
    maxOrdersCapacity: z.number().int().min(1).max(2147483647).default(15),
    isActive: z.boolean().default(true),
  })
  .strict()
  .refine((v) => v.endTime > v.startTime, {
    path: ["endTime"],
    message: "O fim deve ser depois do início.",
  });
export const DeliveryWindowUpdateSchema = DeliveryWindowSchema.safeExtend({
  expectedRevision: z.number().int().positive(),
});
export const AllocateDeliverySchema = z
  .object({
    windowId: id,
    scheduledDate: ScheduledDateSchema,
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export const DeliveryProofSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    receivedByName: z.string().trim().min(2).max(128),
    receiverDocumentLastDigits: z
      .string()
      .regex(/^\d{3}$/)
      .optional(),
    notes: z.string().trim().max(500).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .strict()
  .refine((v) => (v.latitude === undefined) === (v.longitude === undefined), {
    path: ["longitude"],
    message: "Informe as duas coordenadas.",
  });
export const DeliveryWindowsQuerySchema = z
  .object({ date: ScheduledDateSchema.optional() })
  .strict();
export const DeliveryWindowResponseSchema = z
  .object({
    id: z.uuid(),
    storeId: z.uuid(),
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: time,
    endTime: time,
    maxOrdersCapacity: z.number().int().positive(),
    isActive: z.boolean(),
    revision: z.number().int().positive(),
    allocatedCount: z.number().int().nonnegative(),
  })
  .strict();
export const DeliveryWindowsResponseSchema = z
  .object({
    windows: z.array(DeliveryWindowResponseSchema),
    today: ScheduledDateSchema,
    timezone: z.string(),
    date: ScheduledDateSchema,
  })
  .strict();
export const DeliveryTrackingResponseSchema = z
  .object({
    allocation: z
      .object({
        windowId: z.uuid().nullable(),
        scheduledDate: ScheduledDateSchema,
        startTime: time,
        endTime: time,
        timezone: z.string(),
      })
      .strict()
      .nullable(),
    proofRecorded: z.boolean(),
    proof: z
      .object({
        receivedByName: z.string(),
        receiverDocumentMasked: z.string().nullable(),
        notes: z.string().nullable(),
        latitude: z.number().nullable(),
        longitude: z.number().nullable(),
        deliveredAt: z.iso.datetime(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type DeliveryWindow = z.infer<typeof DeliveryWindowResponseSchema>;
export type DeliveryWindows = z.infer<typeof DeliveryWindowsResponseSchema>;
export type DeliveryTracking = z.infer<typeof DeliveryTrackingResponseSchema>;
