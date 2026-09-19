import { runtime, logRuntimeBootSummary } from '../server/config/runtime';
import { dbPool, DATABASE_CONFIGURED } from '../server/db/pool';
import { supabaseAdmin, supabasePublic } from '../server/supabase/client';

type Status = 'pass' | 'warn' | 'fail';
interface PreflightResult { check: string; status: Status; detail?: string }

function redact(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED_DB_URL]')
    .replace(/eyJ[A-Za-z0-9._-]+/g, '[REDACTED_JWT]')
    .slice(0, 240);
}

async function checkRuntimeVars(): Promise<PreflightResult[]> {
  return [
    { check: 'VITE_SUPABASE_URL definida', status: process.env.VITE_SUPABASE_URL ? 'pass' : 'fail' },
    { check: 'VITE_SUPABASE_ANON_KEY definida', status: process.env.VITE_SUPABASE_ANON_KEY ? 'pass' : 'fail' },
    { check: 'SUPABASE_URL definida', status: runtime.supabaseUrl ? 'pass' : 'fail' },
    { check: 'SUPABASE_ANON_KEY definida', status: runtime.supabaseAnonKey ? 'pass' : 'fail' },
    { check: 'SUPABASE_SERVICE_ROLE_KEY definida', status: runtime.supabaseServiceRoleKey ? 'pass' : 'fail', detail: runtime.appEnv !== 'development' ? 'Obrigatória em homologation e production' : undefined },
    { check: 'SUPABASE_DB_URL definida', status: runtime.dbUrl ? 'pass' : 'fail', detail: runtime.dbUrlRejectionReason },
    { check: 'SUPABASE_PROJECT_REF definida', status: runtime.supabaseProjectRef ? 'pass' : 'fail' },
    { check: 'SUPABASE_JWT_SECRET definida', status: runtime.supabaseJwtSecret ? 'pass' : 'warn', detail: 'Obrigatória apenas para validação server-side offline' },
    { check: 'APP_IP_PEPPER definida', status: runtime.ipPepper ? 'pass' : 'warn', detail: 'Recomendada para hashing de IP em auditoria' },
    { check: 'OUTBOX_ENCRYPTION_KEY definida (64 hex)', status: runtime.outboxKey?.length === 64 ? 'pass' : 'warn', detail: 'Necessária a partir da Trilha 04' },
  ];
}

async function checkDbConnectivity(): Promise<PreflightResult> {
  if (!DATABASE_CONFIGURED || !dbPool) return { check: 'Postgres conectável', status: 'fail', detail: 'SUPABASE_DB_URL ausente ou inválida' };
  try {
    const start = Date.now();
    const result = await dbPool.query<{v:string}>('SELECT version() AS v');
    return { check: 'Postgres conectável', status: 'pass', detail: `latency=${Date.now()-start}ms, server=${result.rows[0].v.split(',')[0]}` };
  } catch (error) {
    return { check: 'Postgres conectável', status: 'fail', detail: redact(error instanceof Error ? error.message : String(error)) };
  }
}

async function checkSupabaseAdmin(): Promise<PreflightResult> {
  if (!supabaseAdmin) return { check: 'Supabase Admin API acessível', status: 'fail', detail: 'supabaseAdmin não configurado' };
  try {
    const { error } = await supabaseAdmin.from('app_roles').select('code').limit(1);
    return { check: 'Supabase Admin API acessível', status: error ? 'fail' : 'pass', detail: error ? redact(error.message) : undefined };
  } catch (error) {
    return { check: 'Supabase Admin API acessível', status: 'fail', detail: redact(error instanceof Error ? error.message : String(error)) };
  }
}

async function checkSupabasePublic(): Promise<PreflightResult> {
  if (!supabasePublic) return { check: 'Supabase Public API acessível', status: 'fail', detail: 'supabasePublic não configurado' };
  try {
    const { error } = await supabasePublic.from('app_global_config').select('id').limit(1);
    return { check: 'Supabase Public API acessível', status: error ? 'fail' : 'pass', detail: error ? redact(error.message) : undefined };
  } catch (error) {
    return { check: 'Supabase Public API acessível', status: 'fail', detail: redact(error instanceof Error ? error.message : String(error)) };
  }
}

async function checkRlsEnforced(): Promise<PreflightResult> {
  if (!dbPool) return { check: 'RLS + FORCE RLS em todas as tabelas app_*', status: 'fail' };
  try {
    const result = await dbPool.query<{table_name:string}>(`
      SELECT c.relname AS table_name
      FROM pg_class c
      WHERE c.relnamespace='public'::regnamespace
        AND c.relkind='r'
        AND c.relname LIKE 'app_%'
        AND (c.relrowsecurity=false OR c.relforcerowsecurity=false)
    `);
    return result.rows.length === 0
      ? { check: 'RLS + FORCE RLS em todas as tabelas app_*', status: 'pass' }
      : { check: 'RLS + FORCE RLS em todas as tabelas app_*', status: 'fail', detail: `Incompleto: ${result.rows.map((r)=>r.table_name).join(', ')}` };
  } catch (error) {
    return { check: 'RLS + FORCE RLS em todas as tabelas app_*', status: 'fail', detail: redact(error instanceof Error ? error.message : String(error)) };
  }
}

async function main(): Promise<void> {
  logRuntimeBootSummary();
  console.log('\n[PREFLIGHT] Executando verificações...\n');
  const results = [...await checkRuntimeVars(), await checkDbConnectivity(), await checkSupabaseAdmin(), await checkSupabasePublic(), await checkRlsEnforced()];
  let fails = 0; let warns = 0;
  for (const result of results) {
    const icon = result.status === 'pass' ? 'PASS' : result.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`${icon} ${result.check}${result.detail ? ` — ${result.detail}` : ''}`);
    if (result.status === 'fail') fails++;
    if (result.status === 'warn') warns++;
  }
  console.log(`\n[PREFLIGHT] ${results.length-fails-warns} passaram, ${warns} avisos, ${fails} falhas.`);
  if (dbPool) await dbPool.end();
  if (fails > 0) process.exit(1);
}

main().catch((error) => {
  console.error('[PREFLIGHT] Falha catastrófica:', redact(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
