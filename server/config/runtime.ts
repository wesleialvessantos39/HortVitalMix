import { z } from 'zod';
import type { AppEnvironment } from '../../shared/contracts/foundation';

const ServerEnvSchema = z.object({
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(10).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10).optional(),
  SUPABASE_DB_URL: z.string().optional(),
  SUPABASE_JWT_SECRET: z.string().min(10).optional(),
  SUPABASE_PROJECT_REF: z.string().min(8).optional(),
  APP_ENV: z.enum(['development', 'homologation', 'production']).optional(),
  APP_IP_PEPPER: z.string().min(32).optional(),
  OUTBOX_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
});

function resolveAppEnv(): AppEnvironment {
  const explicit = process.env.APP_ENV;
  if (explicit === 'development' || explicit === 'homologation' || explicit === 'production') return explicit;
  if (process.env.VERCEL_ENV === 'production') return 'production';
  if (process.env.VERCEL_ENV === 'preview') return 'homologation';
  if (process.env.NODE_ENV === 'production') return 'production';
  return 'development';
}

type DbSource = 'SUPABASE_DB_URL' | 'DATABASE_URL' | 'POSTGRES_URL' | null;
const forbidden = new Set(['base', 'host', 'hostname', 'localhost', '127.0.0.1', '::1', '']);
export function resolveDbUrl(env: AppEnvironment, sourceEnv: NodeJS.ProcessEnv = process.env): {url:string|null; source:DbSource; rejectedReason?:string} {
  const candidates: Array<[Exclude<DbSource,null>, string|undefined]> = [
    ['SUPABASE_DB_URL', sourceEnv.SUPABASE_DB_URL],
    ['DATABASE_URL', sourceEnv.DATABASE_URL],
    ['POSTGRES_URL', sourceEnv.POSTGRES_URL],
  ];
  for (const [name, value] of candidates) {
    if (!value) continue;
    if (env !== 'development' && name !== 'SUPABASE_DB_URL') return {url:null,source:null,rejectedReason:`${name} não é aceito em ${env}. Use SUPABASE_DB_URL.`};
    if (!value.startsWith('postgresql://') && !value.startsWith('postgres://')) return {url:null,source:null,rejectedReason:`${name} não é URL PostgreSQL válida.`};
    try {
      const parsed = new URL(value);
      if (forbidden.has(parsed.hostname)) return {url:null,source:null,rejectedReason:`${name} usa hostname placeholder proibido.`};
      return {url:value,source:name};
    } catch { return {url:null,source:null,rejectedReason:`${name} não pôde ser interpretada como URL.`}; }
  }
  return {url:null,source:null,rejectedReason:'Nenhuma variável de conexão presente.'};
}

const appEnv = resolveAppEnv();
const parsed = ServerEnvSchema.safeParse(process.env);
if (!parsed.success && appEnv !== 'development') console.error('[RUNTIME] Configuração server-side inválida.');
const db = resolveDbUrl(appEnv);
export const runtime = Object.freeze({
  appEnv,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? null,
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET ?? null,
  supabaseProjectRef: process.env.SUPABASE_PROJECT_REF ?? '',
  dbUrl: db.url,
  dbUrlSource: db.source,
  dbUrlRejectionReason: db.rejectedReason,
  ipPepper: process.env.APP_IP_PEPPER ?? null,
  outboxKey: process.env.OUTBOX_ENCRYPTION_KEY ?? null,
  isProduction: appEnv === 'production',
  isServerless: Boolean(process.env.VERCEL),
});

export function logRuntimeBootSummary(): void {
  let host = '(missing)';
  try { if (runtime.supabaseUrl) host = new URL(runtime.supabaseUrl).hostname; } catch { host='(invalid)'; }
  console.log('[RUNTIME] Boot', {appEnv:runtime.appEnv,nodeEnv:runtime.nodeEnv,isProduction:runtime.isProduction,isServerless:runtime.isServerless,dbUrlSource:runtime.dbUrlSource,dbConfigured:Boolean(runtime.dbUrl),dbRejectionReason:runtime.dbUrlRejectionReason ?? null,supabaseHost:host,hasServiceRole:Boolean(runtime.supabaseServiceRoleKey),hasJwtSecret:Boolean(runtime.supabaseJwtSecret),hasIpPepper:Boolean(runtime.ipPepper),hasOutboxKey:Boolean(runtime.outboxKey)});
}
