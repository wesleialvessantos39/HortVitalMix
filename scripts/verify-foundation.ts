import { dbPool } from "../server/db/pool.ts";
import { validateHistory } from "./migrations-manifest.ts";
async function main() {
  if (!dbPool) throw new Error("DATABASE_NOT_CONFIGURED");
  const tables = await dbPool.query("SELECT * FROM public.v_rls_audit");
  if (
    tables.rows.length !== 8 ||
    tables.rows.some((r) => !r.rls_enabled || !r.rls_forced)
  )
    throw new Error("RLS_GATE_FAILED");
  const cfg = await dbPool.query(
    "SELECT count(*)::int n FROM public.app_global_config",
  );
  if (cfg.rows[0].n !== 1) throw new Error("SINGLETON_GATE_FAILED");
  const roles = await dbPool.query(
    "SELECT code,is_public FROM public.app_roles ORDER BY code",
  );
  if (
    roles.rows.map((r) => r.code).join(",") !==
      "consumer,platform_admin,platform_super_admin,producer" ||
    roles.rows.filter((r) => r.is_public).length !== 2
  )
    throw new Error("ROLE_GATE_FAILED");
  const history = await dbPool.query(
    "SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version",
  );
  validateHistory(history.rows);
  const security = await dbPool.query(
    "SELECT has_column_privilege('authenticated','public.app_users','status','UPDATE') AS user_write,has_column_privilege('authenticated','public.app_producer_profiles','trust_level','UPDATE') AS trust_write",
  );
  if (security.rows[0].user_write || security.rows[0].trust_write)
    throw new Error("COLUMN_SECURITY_FAILED");
  console.log(
    "Fundação: 8 tabelas, RLS, singleton, papéis, histórico e colunas protegidas aprovados.",
  );
}
main()
  .catch(() => {
    console.error("FOUNDATION_GATE_FAILED");
    process.exitCode = 1;
  })
  .finally(() => dbPool?.end());
