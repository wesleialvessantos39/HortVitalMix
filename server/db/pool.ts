import pg from "pg";
import { runtime } from "../config/runtime.ts";
import { reportFailure } from "../config/reportFailure.ts";

function databaseHostname() {
  try {
    return runtime.dbUrl ? new URL(runtime.dbUrl).hostname : "";
  } catch {
    return "";
  }
}

const hostname = databaseHostname();
const isLocalDb = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
const isSupabaseCloud = Boolean(
  runtime.dbUrl?.includes("supabase.co") || runtime.dbUrl?.includes("pooler.supabase.com"),
);

export const dbPool = runtime.dbUrl
  ? new pg.Pool({
      connectionString: runtime.dbUrl,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      ssl: isLocalDb
        ? false
        : {
            rejectUnauthorized:
              process.env.DATABASE_SSL_STRICT === "true" ? true : !isSupabaseCloud,
          },
    })
  : null;

dbPool?.on("error", () => reportFailure("db_unavailable"));
