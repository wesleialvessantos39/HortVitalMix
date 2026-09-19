import { runtime } from "../server/config/runtime.ts";
import { dbPool } from "../server/db/pool.ts";
import { supabaseAdmin, supabasePublic } from "../server/supabase/client.ts";

function failIf(condition: boolean, code: string, failures: string[]) {
  if (condition) failures.push(code);
}

async function main() {
  const failures: string[] = [];
  const warnings: string[] = [];

  failIf(!dbPool, runtime.dbRejection ?? "DATABASE_NOT_CONFIGURED", failures);
  failIf(!supabaseAdmin, "SUPABASE_ADMIN_NOT_CONFIGURED", failures);
  failIf(!supabasePublic, "SUPABASE_PUBLIC_NOT_CONFIGURED", failures);
  failIf(!runtime.projectRef, "SUPABASE_PROJECT_REF", failures);
  failIf(!process.env.VITE_SUPABASE_URL, "VITE_SUPABASE_URL", failures);
  failIf(!process.env.VITE_SUPABASE_ANON_KEY, "VITE_SUPABASE_ANON_KEY", failures);
  failIf(!runtime.origins.length, "APP_ALLOWED_ORIGINS", failures);

  const pepper = runtime.ipPepper;
  failIf(
    !/^[0-9a-fA-F]{32,}$/.test(pepper),
    "APP_IP_PEPPER_MUST_BE_32_PLUS_HEX",
    failures,
  );

  const outbox = process.env.OUTBOX_ENCRYPTION_KEY ?? "";
  if (!outbox) warnings.push("OUTBOX_ENCRYPTION_KEY ausente; será obrigatória na Trilha 04");
  else failIf(!/^[0-9a-fA-F]{64}$/.test(outbox), "OUTBOX_ENCRYPTION_KEY_INVALID", failures);

  if (!process.env.SUPABASE_JWT_SECRET) {
    warnings.push("SUPABASE_JWT_SECRET ausente; aceitável enquanto a validação usar o SDK/JWKS");
  }

  if (runtime.projectRef) {
    const expectedSupabaseUrl = `https://${runtime.projectRef}.supabase.co`;
    failIf(runtime.supabaseUrl !== expectedSupabaseUrl, "SUPABASE_URL_PROJECT_REF_MISMATCH", failures);
    failIf(process.env.VITE_SUPABASE_URL !== expectedSupabaseUrl, "VITE_SUPABASE_URL_PROJECT_REF_MISMATCH", failures);
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
      const expectedUser = `postgres.${runtime.projectRef}`;
      failIf(db.username !== expectedUser, "DB_PROJECT_REF_MISMATCH", failures);
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
      "PREFLIGHT_FAILED: verificar variáveis e conectividade; nenhum valor de segredo será exibido.",
    );
    process.exitCode = 1;
  })
  .finally(() => dbPool?.end());
