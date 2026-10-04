import { z } from "zod";

export const StoreStatusEnum = z.enum([
  "draft",
  "pending_review",
  "active",
  "paused",
  "closed",
]);
export const StoreSlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(128)
  .regex(
    /^[a-z0-9][a-z0-9-]{1,126}[a-z0-9]$/,
    "Use letras minúsculas, números e hífens, sem hífen nas bordas.",
  );
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const OperatingDaySchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    isHarvestDay: z.boolean(),
    isDeliveryDay: z.boolean(),
    cutoffTime: time,
  })
  .strict();
export const OperatingHoursSchema = z
  .array(OperatingDaySchema)
  .length(7)
  .refine(
    (days) => new Set(days.map((day) => day.dayOfWeek)).size === 7,
    "Informe cada dia da semana exatamente uma vez.",
  );
export const CreateDraftStoreSchema = z
  .object({ commandId: z.uuid() })
  .strict();
export const StoreCommandSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    commandId: z.uuid(),
  })
  .strict();
export const SaveStoreSettingsSchema = StoreCommandSchema.extend({
  propertyId: z.uuid(),
  storeSlug: StoreSlugSchema,
  storeName: z.string().trim().min(2).max(128),
  bio: z.string().trim().min(10).max(2000),
  minOrderAmountCents: z.number().int().min(0).max(100_000_000),
  cutoffHour: time,
  operatingHours: OperatingHoursSchema.optional(),
}).strict();
export const UpdateOperatingHoursSchema = StoreCommandSchema.extend({
  days: OperatingHoursSchema,
}).strict();
export const PauseStoreSchema = StoreCommandSchema.extend({
  reason: z.string().trim().min(3).max(500),
}).strict();

export const StoreOwnerResponseSchema = z
  .object({
    id: z.uuid(),
    producerProfileId: z.uuid(),
    propertyId: z.uuid().nullable(),
    storeSlug: StoreSlugSchema,
    storeName: z.string(),
    bio: z.string(),
    minOrderAmountCents: z.number().int().nonnegative(),
    cutoffHour: time,
    status: StoreStatusEnum,
    revision: z.number().int().positive(),
    avatarUrl: z.string().nullable(),
    bannerUrl: z.string().nullable(),
    operatingHours: OperatingHoursSchema,
  })
  .strict();
export const StoreSettingsResponseSchema = z
  .object({
    store: StoreOwnerResponseSchema.nullable(),
    properties: z.array(
      z
        .object({
          id: z.uuid(),
          name: z.string(),
          location: z.string(),
          approved: z.boolean(),
        })
        .strict(),
    ),
    canPublish: z.boolean(),
  })
  .strict();
export const StorePublicResponseSchema = z
  .object({
    name: z.string(),
    slug: StoreSlugSchema,
    bio: z.string(),
    bannerUrl: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    location: z.string(),
    verification: z
      .object({ isVerified: z.boolean(), trustLevel: z.number().int() })
      .strict(),
    minOrderAmountCents: z.number().int().nonnegative(),
    cutoffHour: time,
    operatingHours: OperatingHoursSchema,
  })
  .strict();

export type OperatingDay = z.infer<typeof OperatingDaySchema>;
export type StoreOwner = z.infer<typeof StoreOwnerResponseSchema>;
export type StoreSettings = z.infer<typeof StoreSettingsResponseSchema>;
export type StorePublic = z.infer<typeof StorePublicResponseSchema>;
export type StoreCommand = z.infer<typeof StoreCommandSchema>;
export type SaveStoreSettings = z.infer<typeof SaveStoreSettingsSchema>;
export type PauseStore = z.infer<typeof PauseStoreSchema>;
export type UpdateOperatingHours = z.infer<typeof UpdateOperatingHoursSchema>;
export const STORE_DAY_LABELS = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const;
