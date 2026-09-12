import { z } from 'zod';

const requestIdSchema = z.string().uuid();
const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/);
const stateCodeSchema = z.string().regex(/^[A-Z]{2}$/);
const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);
const localeSchema = z.string().regex(/^[a-z]{2}-[A-Z]{2}$/);
const timezoneSchema = z.string().trim().min(1).max(80);

const nullableEmailSchema = z.union([z.string().trim().email().max(254), z.null()]);
const nullablePhoneSchema = z.union([
  z.string().trim().min(8).max(32).regex(/^\+?[0-9 ()-]+$/),
  z.null(),
]);

export const brandConfigurationSchema = z.object({
  name: z.literal('HortiVitalMix'),
  tagline: z.string().trim().min(1).max(120),
  pageTitle: z.string().trim().min(1).max(120),
  logoAltText: z.string().trim().min(1).max(160),
  theme: z.object({
    primary: hexColorSchema,
    secondary: hexColorSchema,
    accent: hexColorSchema,
  }).strict(),
}).strict();

export const contactConfigurationSchema = z.object({
  email: nullableEmailSchema,
  phone: nullablePhoneSchema,
  whatsapp: nullablePhoneSchema,
}).strict();

export const regionConfigurationSchema = z.object({
  countryCode: countryCodeSchema,
  stateCode: stateCodeSchema,
  city: z.string().trim().min(2).max(80),
}).strict();

export const parameterConfigurationSchema = z.object({
  locale: localeSchema,
  currency: currencyCodeSchema,
  timezone: timezoneSchema,
}).strict();

export const publicConfigDataSchema = z.object({
  revision: z.number().int().nonnegative(),
  source: z.enum(['default', 'database']),
  brand: brandConfigurationSchema,
  contacts: contactConfigurationSchema,
  region: regionConfigurationSchema,
  parameters: parameterConfigurationSchema,
}).strict();

export const publicConfigSchema = publicConfigDataSchema.extend({
  requestId: requestIdSchema,
}).strict();

const editableBrandSchema = z.object({
  tagline: z.string().trim().min(1).max(120).optional(),
  pageTitle: z.string().trim().min(1).max(120).optional(),
  logoAltText: z.string().trim().min(1).max(160).optional(),
}).strict();

const editableContactsSchema = contactConfigurationSchema.partial().strict();
const editableRegionSchema = regionConfigurationSchema.partial().strict();
const editableParametersSchema = parameterConfigurationSchema.partial().strict();

export const updateGlobalConfigurationSchema = z.object({
  commandId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  changes: z.object({
    brand: editableBrandSchema.optional(),
    contacts: editableContactsSchema.optional(),
    region: editableRegionSchema.optional(),
    parameters: editableParametersSchema.optional(),
  }).strict(),
}).strict().superRefine((value, context) => {
  const sections = Object.values(value.changes);
  const hasChange = sections.some((section) => section && Object.keys(section).length > 0);
  if (!hasChange) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['changes'],
      message: 'Informe ao menos um campo permitido para alteração.',
    });
  }
});

export const updateGlobalConfigurationResponseSchema = z.object({
  status: z.literal('confirmed'),
  config: publicConfigSchema,
  changed: z.boolean(),
  idempotent: z.boolean(),
  requestId: requestIdSchema,
}).strict();

export type PublicConfigData = z.infer<typeof publicConfigDataSchema>;
export type PublicConfig = z.infer<typeof publicConfigSchema>;
export type UpdateGlobalConfigurationInput = z.infer<typeof updateGlobalConfigurationSchema>;
export type UpdateGlobalConfigurationResponse = z.infer<typeof updateGlobalConfigurationResponseSchema>;
