import { z } from "zod";
export const UpdateGlobalConfigSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    commandId: z.uuid(),
    payload: z
      .object({
        slogan: z.string().min(5).max(255).optional(),
        defaultMunicipality: z.string().min(2).max(100).optional(),
        defaultState: z.string().length(2).optional(),
        supportEmail: z.email().optional(),
        supportPhone: z.string().min(8).max(32).nullable().optional(),
      })
      .strict(),
  })
  .strict();
