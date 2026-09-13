import { z } from 'zod';

export const requestIdSchema = z.string().uuid();
export const dependencyStatusSchema = z.enum(['ready', 'unavailable']);
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;
export const databaseBindingStatusSchema = z.enum(['ready', 'unavailable', 'unbound', 'mismatch']);
export type DatabaseBindingStatus = z.infer<typeof databaseBindingStatusSchema>;
export const migrationIntegrityStatusSchema = z.enum(['valid', 'incomplete', 'drift', 'unavailable']);
export type MigrationIntegrityStatus = z.infer<typeof migrationIntegrityStatusSchema>;
export const appEnvironmentSchema = z.enum(['development', 'homologation', 'production']);

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('hortivitalmix-api'),
  presentation: z.literal('available'),
  environment: appEnvironmentSchema,
  database: dependencyStatusSchema,
  databaseBinding: databaseBindingStatusSchema,
  migrationIntegrity: migrationIntegrityStatusSchema,
  requestId: requestIdSchema,
}).strict();
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'unavailable']),
  environment: appEnvironmentSchema,
  dependencies: z.object({ database: dependencyStatusSchema }).strict(),
  databaseBinding: databaseBindingStatusSchema,
  migrationIntegrity: migrationIntegrityStatusSchema,
  expectedDatabaseEnvironment: appEnvironmentSchema,
  actualDatabaseEnvironment: appEnvironmentSchema.nullable(),
  expectedSchemaVersion: z.number().int().positive(),
  actualSchemaVersion: z.number().int().positive().nullable(),
  expectedReleaseVersion: z.string().min(1),
  releaseVersion: z.string().nullable(),
  requestId: requestIdSchema,
}).strict();
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

export const environmentResponseSchema = z.object({
  environment: appEnvironmentSchema,
  deploymentSource: z.enum(['explicit', 'vercel', 'local']),
  databaseConfigured: z.boolean(),
  databaseBinding: databaseBindingStatusSchema,
  databaseEnvironment: appEnvironmentSchema.nullable(),
  migrationIntegrity: migrationIntegrityStatusSchema,
  expectedSchemaVersion: z.number().int().positive(),
  schemaVersion: z.number().int().positive().nullable(),
  expectedReleaseVersion: z.string().min(1),
  releaseVersion: z.string().nullable(),
  indexing: z.enum(['index', 'noindex']),
  tlsRequired: z.boolean(),
  secureCookies: z.boolean(),
  testTokensEnabled: z.boolean(),
  requestId: requestIdSchema,
}).strict();
export type EnvironmentResponse = z.infer<typeof environmentResponseSchema>;

export const apiErrorSchema = z.object({
  error: z.object({ code: z.string().min(1), message: z.string().min(1) }),
  requestId: requestIdSchema,
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export {
  publicConfigDataSchema,
  publicConfigSchema,
  updateGlobalConfigurationResponseSchema,
  updateGlobalConfigurationSchema,
  type PublicConfigData,
  type PublicConfig,
  type UpdateGlobalConfigurationInput,
  type UpdateGlobalConfigurationResponse,
} from './configuration';
