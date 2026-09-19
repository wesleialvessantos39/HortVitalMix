import { dbPool } from "../server/db/pool.ts";
import { validateHistory } from "./migrations-manifest.ts";

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
