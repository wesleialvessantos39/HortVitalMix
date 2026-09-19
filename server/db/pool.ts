import pg from "pg";
import { runtime } from "../config/runtime.ts";
import { reportFailure } from "../config/reportFailure.ts";
export const dbPool = runtime.dbUrl
  ? new pg.Pool({
      connectionString: runtime.dbUrl,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      ssl: { rejectUnauthorized: true },
    })
  : null;
dbPool?.on("error", () => reportFailure("db_unavailable"));
