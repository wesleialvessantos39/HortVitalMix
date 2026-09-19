import { runtime } from "../server/config/runtime.ts";
import { dbPool } from "../server/db/pool.ts";
import { supabaseAdmin, supabasePublic } from "../server/supabase/client.ts";
async function main() {
  const missing = [];
  if (!dbPool) missing.push(runtime.dbRejection);
  if (!supabaseAdmin) missing.push("SUPABASE_ADMIN_NOT_CONFIGURED");
  if (!supabasePublic) missing.push("SUPABASE_PUBLIC_NOT_CONFIGURED");
  if (runtime.ipPepper.length < 16) missing.push("APP_IP_PEPPER");
  if (!runtime.origins.length) missing.push("APP_ALLOWED_ORIGINS");
  if (!runtime.projectRef) missing.push("SUPABASE_PROJECT_REF");
  if (missing.length) {
    console.error("Configurações pendentes:", missing.join(", "));
    throw new Error("MISSING_CONFIGURATION");
  }
  await dbPool!.query("SELECT 1");
  const { error } = await supabaseAdmin!.auth.admin.listUsers({
    page: 1,
    perPage: 1,
  });
  if (error) throw new Error("AUTH_UNAVAILABLE");
  console.log("Preflight aprovado.");
}
main()
  .catch((e) => {
    console.error(
      "PREFLIGHT_FAILED: verificar variáveis e conectividade; nenhum valor de segredo será exibido.",
    );
    process.exitCode = 1;
  })
  .finally(() => dbPool?.end());
