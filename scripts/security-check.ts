import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
function walk(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(path, e.name)) : [join(path, e.name)],
  );
}
const forbidden =
  /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_DB_URL|SUPABASE_JWT_SECRET|APP_IP_PEPPER|(?:from|import)\s*['"][^'"]*server\//;
const errors = walk("src").filter((f) =>
  forbidden.test(readFileSync(f, "utf8")),
);
if (errors.length) {
  console.error("SERVER_ONLY_IMPORT_IN_CLIENT", errors);
  process.exit(1);
}
console.log("Cliente sem referências a segredos server-side.");
