import pg from "pg";
import { runtime } from "../config/runtime.ts";
import { reportFailure } from "../config/reportFailure.ts";
const isSupabase = Boolean(runtime.dbUrl?.includes("supabase.co") || runtime.dbUrl?.includes("pooler.supabase.com"));
export const dbPool = runtime.dbUrl
  ? new pg.Pool({
      connectionString: runtime.dbUrl,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      ssl: {
        rejectUnauthorized: process.env.DATABASE_SSL_STRICT === "true" ? true : !isSupabase,
      },
    })
  : null;
dbPool?.on("error", () => reportFailure("db_unavailable"));
