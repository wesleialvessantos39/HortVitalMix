import { runtime, logRuntimeBootSummary } from "../server/config/runtime.ts";
import { dbPool } from "../server/db/pool.ts";
import { supabaseAdmin, supabasePublic } from "../server/supabase/client.ts";

function failIf(condition: boolean, code: string, failures: string[]) {
  if (condition) failures.push(code);
}

async function main() {
  const failures: string[] = [];
  const warnings: string[] = [];

  logRuntimeBootSummary();

  failIf(!dbPool, runtime.dbRejection ?? "DATABASE_NOT_CONFIGURED", failures);
  failIf(!supabaseAdmin, "SUPABASE_ADMIN_NOT_CONFIGURED", failures);
  failIf(!supabasePublic, "SUPABASE_PUBLIC_NOT_CONFIGURED", failures);
  failIf(!runtime.projectRef, "SUPABASE_PROJECT_REF", failures);
  failIf(!process.env.VITE_SUPABASE_URL, "VITE_SUPABASE_URL", failures);
  failIf(!process.env.VITE_SUPABASE_ANON_KEY, "VITE_SUPABASE_ANON_KEY", failures);
  if (!runtime.origins.length)
    warnings.push(
      "APP_ALLOWED_ORIGINS ausente; somente a própria origem HTTPS será aceita automaticamente",
    );

  failIf(
    !/^[0-9a-fA-F]{32,}$/.test(runtime.ipPepper),
    "APP_IP_PEPPER_MUST_BE_32_PLUS_HEX",
    failures,
  );

  else
    failIf(
      !/^[0-9a-fA-F]{64}$/.test(runtime.outboxKey),
      "OUTBOX_ENCRYPTION_KEY_INVALID",
      failures,
    );

  if (runtime.projectRef) {
    const expectedSupabaseUrl = `https://${runtime.projectRef}.supabase.co`;
    failIf(
      runtime.supabaseUrl !== expectedSupabaseUrl,
      "SUPABASE_URL_PROJECT_REF_MISMATCH",
      failures,
    );
    failIf(
      process.env.VITE_SUPABASE_URL !== expectedSupabaseUrl,
      "VITE_SUPABASE_URL_PROJECT_REF_MISMATCH",
      failures,
    );
  }

  failIf(
    Boolean(process.env.VITE_SUPABASE_ANON_KEY && runtime.anonKey) &&
      process.env.VITE_SUPABASE_ANON_KEY !== runtime.anonKey,
    "PUBLIC_ANON_KEY_MISMATCH",
    failures,
  );

  if (runtime.dbUrl && runtime.projectRef) {
    try {
      const db = new URL(runtime.dbUrl);
      failIf(
        db.username !== `postgres.${runtime.projectRef}`,
        "DB_PROJECT_REF_MISMATCH",
        failures,
      );
    } catch {
      failures.push("INVALID_TRANSACTION_POOLER_URL");
    }
  }

  if (failures.length) {
    console.error("PREFLIGHT_FAILED:", failures.join(", "));
    if (warnings.length) console.warn("PREFLIGHT_WARN:", warnings.join(" | "));
    process.exitCode = 1;
    return;
  }

  await dbPool!.query("SELECT 1");

  const rls = await dbPool!.query<{ table_name: string }>(
    "SELECT table_name FROM public.v_rls_audit WHERE rls_enabled=false OR rls_forced=false ORDER BY table_name",
  );
  if (rls.rows.length)
    throw new Error("RLS_GATE_FAILED");

  const tables = await dbPool!.query<{ n: number }>(
    "SELECT count(*)::int n FROM public.v_rls_audit",
  );
  if (tables.rows[0].n !== 9)
    throw new Error("FOUNDATION_TABLE_COUNT_FAILED");

  const { error: adminError } = await supabaseAdmin!.auth.admin.listUsers({
    page: 1,
    perPage: 1,
  });
  if (adminError) throw new Error("AUTH_UNAVAILABLE");

  const { error: publicError } = await supabasePublic!
    .from("app_global_config")
    .select("id")
    .limit(1);
  if (publicError) throw new Error("PUBLIC_DATA_API_UNAVAILABLE");

  console.log("Preflight aprovado.");
  if (warnings.length) console.warn("PREFLIGHT_WARN:", warnings.join(" | "));
}

main()
  .catch(() => {
    console.error(
      "PREFLIGHT_FAILED: verificar variáveis, RLS e conectividade; nenhum valor de segredo será exibido.",
    );
    process.exitCode = 1;
  })
  .finally(() => dbPool?.end());
