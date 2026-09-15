import {z} from 'zod';
import {AppEnvironmentSchema} from '../../shared/contracts/foundation';

const RuntimeConfigSchema = z.object({
  APP_ENV: AppEnvironmentSchema.default('development'),
  DATABASE_URL: z.string().min(1).optional(),
  APP_RELEASE: z.string().min(1).default('local'),
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export function getRuntimeConfig(): RuntimeConfig {
  return RuntimeConfigSchema.parse(process.env);
}
