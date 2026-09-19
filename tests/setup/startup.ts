import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export default async function globalSetup() {
  const here = dirname(fileURLToPath(import.meta.url));
  config({ path: resolve(here, "../../.env.test"), override: true });
  config({ path: resolve(here, "../../.env.local"), override: false });

  const requested = process.env.HVM_INTEGRATION_ENABLED === "true";
  const required = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_DB_URL",
    "SUPABASE_PROJECT_REF",
  ];
  const missing = required.filter((name) => !process.env[name]);

  if (requested && missing.length) {
    throw new Error(
      `INTEGRATION_CONFIGURATION_MISSING: ${missing.join(",")}`,
    );
  }

  process.env.HVM_INTEGRATION_ENABLED = requested ? "true" : "false";
  process.env.NODE_ENV = "test";
}
