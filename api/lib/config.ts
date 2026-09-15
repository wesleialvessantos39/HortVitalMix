import {z} from 'zod';

const schema = z.object({
  APP_ENV: z.enum(['development', 'homologation', 'production', 'test']).default('development'),
  APP_RELEASE: z.string().min(1).default('local'),
  DATABASE_URL: z.string().url().optional(),
  PLATFORM_CONFIG_ADMIN_TOKEN: z.string().min(32).optional(),
});

export type RuntimeConfig = z.infer<typeof schema>;

export function getRuntimeConfig(): RuntimeConfig {
  return schema.parse(process.env);
}
