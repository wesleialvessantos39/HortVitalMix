import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const patterns = [
  /SUPABASE_SERVICE_ROLE_KEY/,
  /SUPABASE_DB_URL/,
  /SUPABASE_JWT_SECRET/,
  /postgres(?:ql)?:\/\//,
  /sb_secret_/,
  /service_role/,
];
for (const file of readdirSync("dist/assets")) {
  if (!file.endsWith(".js")) continue;
  const text = readFileSync(join("dist/assets", file), "utf8");
  if (patterns.some((p) => p.test(text)))
    throw new Error("SECRET_PATTERN_IN_BUNDLE");
  for (const name of [
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_DB_URL",
    "SUPABASE_JWT_SECRET",
    "APP_IP_PEPPER",
  ]) {
    const value = process.env[name];
    if (value && text.includes(value))
      throw new Error("SECRET_VALUE_IN_BUNDLE");
  }
}
console.log("Bundle verificado: nenhum segredo detectado.");
