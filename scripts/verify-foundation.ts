import { createHash } from 'crypto';
import { readdir, readFile } from 'fs/promises';
import { dbPool } from '../server/db/pool';

type Check = { name: string; passed: boolean; detail?: string };

async function migrationHistory() {
  const files = (await readdir('supabase/migrations')).filter((file) => file.endsWith('.sql')).sort();
  const hash = createHash('sha256');
  for (const file of files) hash.update(file).update(await readFile(`supabase/migrations/${file}`));
  return { files, hash: hash.digest('hex') };
}

async function runChecks(): Promise<Check[]> {
  if (!dbPool) return [{name:'db_connection',passed:false,detail:'dbPool não configurado'}];
  const client = await dbPool.connect();
  try {
    const results: Check[] = [];
    const missingRls = await client.query<{table_name:string}>(`SELECT c.relname table_name FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND c.relname LIKE 'app_%' AND c.relrowsecurity=false`);
    results.push({name:'rls_enabled_on_all_app_tables',passed:missingRls.rows.length===0,detail:missingRls.rows.length?missingRls.rows.map(r=>r.table_name).join(', '):'OK'});
    const missingForce = await client.query<{table_name:string}>(`SELECT c.relname table_name FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND c.relname LIKE 'app_%' AND c.relforcerowsecurity=false`);
    results.push({name:'force_rls_on_all_app_tables',passed:missingForce.rows.length===0,detail:missingForce.rows.length?missingForce.rows.map(r=>r.table_name).join(', '):'OK'});
    const tables = await client.query<{table_name:string}>(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'app_%' ORDER BY table_name`);
    results.push({name:'foundation_table_count',passed:tables.rows.length===8,detail:`count=${tables.rows.length}`});
    const auditTrigger = await client.query(`SELECT 1 FROM pg_trigger WHERE tgrelid='public.app_audit_events'::regclass AND tgname='trg_app_audit_events_immutable' AND NOT tgisinternal`);
    results.push({name:'audit_immutability_trigger_present',passed:auditTrigger.rows.length===1});
    const auditTruncate = await client.query(`SELECT 1 FROM pg_trigger WHERE tgrelid='public.app_audit_events'::regclass AND tgname='trg_app_audit_events_no_truncate' AND NOT tgisinternal`);
    results.push({name:'audit_truncate_trigger_present',passed:auditTruncate.rows.length===1});
    const authCreate = await client.query(`SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND tgname='trg_hortivital_auth_user_created' AND NOT tgisinternal`);
    results.push({name:'auth_users_mirror_trigger_present',passed:authCreate.rows.length===1});
    const authDelete = await client.query(`SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND tgname='trg_hortivital_auth_user_deleted' AND NOT tgisinternal`);
    results.push({name:'auth_users_delete_trigger_present',passed:authDelete.rows.length===1});
    const config = await client.query<{count:string}>(`SELECT COUNT(*)::text count FROM public.app_global_config`);
    results.push({name:'global_config_singleton_present',passed:config.rows[0].count==='1',detail:`count=${config.rows[0].count}`});
    const roles = await client.query<{code:string}>(`SELECT code FROM public.app_roles ORDER BY code`);
    const expected = ['consumer','platform_admin','platform_super_admin','producer'];
    const actual = roles.rows.map(r=>r.code);
    results.push({name:'canonical_roles_present',passed:JSON.stringify(actual)===JSON.stringify(expected),detail:actual.join(',')});
    const duplicateRelease = await client.query<{environment:string}>(`SELECT environment FROM public.app_releases WHERE is_current=true GROUP BY environment HAVING COUNT(*)>1`);
    results.push({name:'single_current_release_per_env',passed:duplicateRelease.rows.length===0,detail:duplicateRelease.rows.length?duplicateRelease.rows.map(r=>r.environment).join(', '):'OK'});
    const credentials = await client.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('app_password_credentials','app_sessions')`);
    results.push({name:'no_local_credential_tables',passed:credentials.rows.length===0});
    const securityDefiners = await client.query<{proname:string;proconfig:string[]|null}>(`SELECT p.proname,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef=true AND p.proname IN ('has_role','is_platform_super_admin','is_any_platform_admin','current_person_id','hash_ip','trg_fn_auth_user_created','trg_fn_auth_user_deleted')`);
    results.push({name:'security_definer_search_path',passed:securityDefiners.rows.length===7 && securityDefiners.rows.every(r=>(r.proconfig??[]).some(v=>v.startsWith('search_path='))),detail:`functions=${securityDefiners.rows.length}`});
    const bucket = await client.query<{public:boolean}>(`SELECT public FROM storage.buckets WHERE id='documents'`);
    results.push({name:'documents_bucket_private',passed:bucket.rows.length===1 && bucket.rows[0].public===false});
    const storagePolicies = await client.query<{policyname:string}>(`SELECT policyname FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname IN ('documents_owner_read','documents_owner_insert') ORDER BY policyname`);
    results.push({name:'documents_owner_policies_present',passed:storagePolicies.rows.length===2,detail:storagePolicies.rows.map(r=>r.policyname).join(',')});
    const migration = await migrationHistory();
    results.push({name:'eight_migrations_versioned',passed:migration.files.length===8,detail:`count=${migration.files.length}; sha256=${migration.hash}`});
    return results;
  } finally { client.release(); }
}

(async()=>{
  const results=await runChecks(); let failures=0;
  for(const result of results){console.log(`${result.passed?'PASS':'FAIL'} ${result.name}${result.detail?` — ${result.detail}`:''}`);if(!result.passed)failures++;}
  if(dbPool)await dbPool.end();
  if(failures){console.error(`\n${failures} verificação(ões) falharam.`);process.exit(1)}
  console.log(`\nTodas as ${results.length} verificações passaram.`);
})();
