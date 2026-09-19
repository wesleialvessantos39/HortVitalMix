import { dbPool } from "../server/db/pool.ts";
import { assertManifestHash, validateHistory } from "./migrations-manifest.ts";

type Check = {
  id: string;
  name: string;
  passed: boolean;
  detail: string;
};

async function main() {
  if (!dbPool) throw new Error("DATABASE_NOT_CONFIGURED");

  const client = await dbPool.connect();
  const checks: Check[] = [];

  const add = (id: string, name: string, passed: boolean, detail: string) => {
    checks.push({ id, name, passed, detail });
  };

  try {
    const history = await client.query(
      "SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version",
    );
    const schemaVersion = validateHistory(history.rows);
    if (schemaVersion !== 8) throw new Error("MIGRATION_HISTORY_GATE_FAILED");

    const extensions = await client.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto','pg_trgm','btree_gin') ORDER BY extname",
    );
    add(
      "A1",
      "Extensões instaladas",
      extensions.rows.length === 3,
      `count=${extensions.rows.length}/3`,
    );

    const tables = await client.query<{ n: number }>(
      "SELECT count(*)::int n FROM pg_class WHERE relnamespace='public'::regnamespace AND relname LIKE 'app\\_%' ESCAPE '\\' AND relkind='r'",
    );
    add("A2", "Tabelas app_* presentes", tables.rows[0].n === 8, `count=${tables.rows[0].n}/8`);

    const rlsDisabled = await client.query<{ table_name: string }>(
      "SELECT table_name FROM public.v_rls_audit WHERE rls_enabled=false ORDER BY table_name",
    );
    add(
      "A3",
      "RLS habilitado em todas",
      rlsDisabled.rows.length === 0,
      rlsDisabled.rows.length ? rlsDisabled.rows.map((r) => r.table_name).join(",") : "0 pendências",
    );

    const rlsNotForced = await client.query<{ table_name: string }>(
      "SELECT table_name FROM public.v_rls_audit WHERE rls_forced=false ORDER BY table_name",
    );
    add(
      "A4",
      "RLS forçado em todas",
      rlsNotForced.rows.length === 0,
      rlsNotForced.rows.length ? rlsNotForced.rows.map((r) => r.table_name).join(",") : "0 pendências",
    );

    for (const [id, name, trigger] of [
      ["A5", "Trigger de auditoria", "trg_app_audit_events_immutable"],
      ["A6", "Trigger espelho auth→app", "trg_hortivital_auth_user_created"],
      ["A7", "Trigger deleção auth→app", "trg_hortivital_auth_user_deleted"],
      ["A8", "Trigger bump global config", "trg_app_global_config_bump_revision"],
    ] as const) {
      const result = await client.query<{ n: number }>(
        "SELECT count(*)::int n FROM pg_trigger WHERE tgname=$1 AND NOT tgisinternal",
        [trigger],
      );
      add(id, name, result.rows[0].n === 1, `count=${result.rows[0].n}/1`);
    }

    const config = await client.query<{ n: number }>(
      "SELECT count(*)::int n FROM public.app_global_config",
    );
    add("A9", "Singleton app_global_config", config.rows[0].n === 1, `count=${config.rows[0].n}/1`);

    const roles = await client.query<{ code: string }>(
      "SELECT code FROM public.app_roles ORDER BY code",
    );
    const expectedRoles = [
      "consumer",
      "platform_admin",
      "platform_super_admin",
      "producer",
    ];
    const actualRoles = roles.rows.map((r) => r.code);
    add(
      "A10",
      "Papéis canônicos",
      JSON.stringify(actualRoles) === JSON.stringify(expectedRoles),
      actualRoles.join(","),
    );

    const duplicateRelease = await client.query<{ environment: string; n: number }>(
      "SELECT environment,count(*)::int n FROM public.app_releases WHERE is_current GROUP BY environment HAVING count(*)>1",
    );
    add(
      "A11",
      "Release corrente única",
      duplicateRelease.rows.length === 0,
      duplicateRelease.rows.length ? duplicateRelease.rows.map((r) => `${r.environment}=${r.n}`).join(",") : "0 duplicidades",
    );

    const credentialTables = await client.query<{ n: number }>(
      "SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('app_password_credentials','app_sessions')",
    );
    add(
      "A12",
      "Sem tabela local de credenciais",
      credentialTables.rows[0].n === 0,
      `count=${credentialTables.rows[0].n}`,
    );

    const badSecDef = await client.query<{ proname: string }>(`
      SELECT p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public'
        AND p.prosecdef=true
        AND p.prokind='f'
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(coalesce(p.proconfig,ARRAY[]::text[])) cfg
          WHERE cfg LIKE 'search_path=%'
        )
      ORDER BY p.proname
    `);
    add(
      "A13",
      "SECURITY DEFINER com search_path",
      badSecDef.rows.length === 0,
      badSecDef.rows.length ? badSecDef.rows.map((r) => r.proname).join(",") : "0 pendências",
    );

    const policiesWithoutRole = await client.query<{ policyname: string }>(`
      SELECT policyname
      FROM pg_policies
      WHERE (
        (schemaname='public' AND tablename LIKE 'app\\_%' ESCAPE '\\')
        OR
        (schemaname='storage' AND tablename='objects' AND policyname LIKE 'documents\\_%' ESCAPE '\\')
      )
      AND coalesce(cardinality(roles),0)=0
      ORDER BY policyname
    `);
    add(
      "A14",
      "Policies com TO explícito",
      policiesWithoutRole.rows.length === 0,
      policiesWithoutRole.rows.length ? policiesWithoutRole.rows.map((r) => r.policyname).join(",") : "0 pendências",
    );

    const pii = await client.query<{ n: number }>(`
      SELECT count(*)::int n
      FROM public.app_audit_events
      WHERE (
        coalesce(payload_before::text,'') || ' ' || coalesce(payload_after::text,'')
      ) ~* $pii$([A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,})|([0-9]{3}\\.[0-9]{3}\\.[0-9]{3}-[0-9]{2})|(^|[^0-9])[0-9]{11}([^0-9]|$)$pii$
    `);
    add(
      "A15",
      "Sem PII em payloads de auditoria",
      pii.rows[0].n === 0,
      `matches=${pii.rows[0].n}`,
    );

    const documentation = await client.query<{
      tables_without_comment: number;
      functions_without_comment: number;
      sensitive_columns_without_comment: number;
    }>(`
      SELECT
        (
          SELECT count(*)::int
          FROM pg_class c
          WHERE c.relnamespace='public'::regnamespace
            AND c.relkind='r'
            AND c.relname LIKE 'app\\_%' ESCAPE '\\'
            AND obj_description(c.oid,'pg_class') IS NULL
        ) AS tables_without_comment,
        (
          SELECT count(*)::int
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public'
            AND (
              p.proname LIKE 'trg_fn\\_%' ESCAPE '\\'
              OR p.proname IN (
                'has_role','is_platform_super_admin','is_any_platform_admin',
                'current_person_id','hash_ip'
              )
            )
            AND obj_description(p.oid,'pg_proc') IS NULL
        ) AS functions_without_comment,
        (
          SELECT count(*)::int
          FROM pg_class c
          JOIN pg_attribute a ON a.attrelid=c.oid
          WHERE c.relnamespace='public'::regnamespace
            AND a.attnum>0
            AND NOT a.attisdropped
            AND (
              (c.relname='app_people' AND a.attname IN ('cpf_normalized','email_normalized','phone_e164'))
              OR
              (c.relname='app_audit_events' AND a.attname IN ('payload_before','payload_after','client_ip_hash','user_agent_hash'))
              OR
              (c.relname='app_users' AND a.attname IN ('status','authorization_revision','blocked_by','block_reason'))
              OR
              (c.relname='app_user_role_assignments' AND a.attname IN ('granted_by','revoked_by','revoke_reason'))
              OR
              (c.relname='app_producer_profiles' AND a.attname IN ('verification_status','trust_level'))
            )
            AND col_description(c.oid,a.attnum) IS NULL
        ) AS sensitive_columns_without_comment
    `);

    const docs = documentation.rows[0];
    const documentationPassed =
      docs.tables_without_comment === 0 &&
      docs.functions_without_comment === 0 &&
      docs.sensitive_columns_without_comment === 0;

    console.log(
      `${documentationPassed ? "PASS" : "FAIL"} DOC SQL comments — tables=${docs.tables_without_comment}, functions=${docs.functions_without_comment}, sensitive_columns=${docs.sensitive_columns_without_comment}`,
    );
    console.log(`PASS HASH migration_history_hash=${migrationHistoryHash}`);

    if (!documentationPassed)
      throw new Error("DOCUMENTATION_GATE_FAILED");

    for (const check of checks) {
      console.log(
        `${check.passed ? "PASS" : "FAIL"} ${check.id} ${check.name} — ${check.detail}`,
      );
    }

    const passed = checks.filter((check) => check.passed).length;
    console.log(`verify:foundation: ${passed}/15; schema_version=${schemaVersion}`);

    if (checks.length !== 15 || passed !== 15) {
      throw new Error("FOUNDATION_GATE_FAILED");
    }
  } finally {
    client.release();
  }
}

main()
  .catch(() => {
    console.error("FOUNDATION_GATE_FAILED");
    process.exitCode = 1;
  })
  .finally(() => dbPool?.end());
