import { z } from 'zod';

const appEnvironmentSchema = z.enum(['development', 'homologation', 'production']);

const portSchema = z.preprocess(
  (value) => (value === undefined || value === '' ? 3001 : Number(value)),
  z.number().int().min(1).max(65535),
);

const runtimeSchema = z.object({
  APP_ENV: appEnvironmentSchema.default('development'),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  API_PORT: portSchema,
  DATABASE_URL: z.string().min(1).optional(),
});

export type AppEnvironment = z.infer<typeof appEnvironmentSchema>;

export interface RuntimeConfig {
  environment: AppEnvironment;
  appBaseUrl: string;
  apiPort: number;
  databaseUrl?: string;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const parsed = runtimeSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid runtime configuration: ${parsed.error.issues.map((issue) => issue.path.join('.') || 'environment').join(', ')}`);
  }

  return {
    environment: parsed.data.APP_ENV,
    appBaseUrl: parsed.data.APP_BASE_URL,
    apiPort: parsed.data.API_PORT,
    databaseUrl: parsed.data.DATABASE_URL,
  };
}
