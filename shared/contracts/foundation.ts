import { z } from 'zod';

export const requestIdSchema = z.string().uuid();

export const dependencyStatusSchema = z.enum(['ready', 'unavailable']);
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('hortivitalmix-api'),
  presentation: z.literal('available'),
  database: dependencyStatusSchema,
  requestId: requestIdSchema,
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'unavailable']),
  dependencies: z.object({
    database: dependencyStatusSchema,
  }),
  requestId: requestIdSchema,
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

export const publicConfigSchema = z.object({
  brand: z.object({
    name: z.literal('HortiVitalMix'),
    tagline: z.string().min(1).max(120),
  }),
  locale: z.literal('pt-BR'),
  market: z.object({
    city: z.string().min(1).max(80),
    state: z.string().length(2),
  }),
  presentationMode: z.boolean(),
  requestId: requestIdSchema,
});
export type PublicConfig = z.infer<typeof publicConfigSchema>;

export const environmentResponseSchema = z.object({
  environment: z.enum(['development', 'homologation', 'production']),
  databaseConfigured: z.boolean(),
  requestId: requestIdSchema,
});
export type EnvironmentResponse = z.infer<typeof environmentResponseSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
  requestId: requestIdSchema,
});
export type ApiError = z.infer<typeof apiErrorSchema>;
