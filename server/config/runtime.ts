import "dotenv/config";
import type { AppEnvironment } from "../../shared/contracts/foundation.ts";

type DbSource = "SUPABASE_DB_URL" | "DATABASE_URL" | "POSTGRES_URL" | null;

export function resolveAppEnv(env: NodeJS.ProcessEnv): AppEnvironment {
  if (env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview") return "homologation";
  if (["development", "homologation", "production"].includes(env.APP_ENV ?? ""))
    return env.APP_ENV as AppEnvironment;
  return env.NODE_ENV === "production" ? "production" : "development";
}

export function resolveDbUrl(
  env: NodeJS.ProcessEnv,
  appEnv = resolveAppEnv(env),
): { url: string | null; reason: string | null; source: DbSource } {
  const candidates: Array<[Exclude<DbSource, null>, string | undefined]> = [
    ["SUPABASE_DB_URL", env.SUPABASE_DB_URL],
    ["DATABASE_URL", env.DATABASE_URL],
    ["POSTGRES_URL", env.POSTGRES_URL],
  ];

  const configured = candidates.filter(
    (candidate): candidate is [Exclude<DbSource, null>, string] =>
      Boolean(candidate[1]),
  );
  if (!configured.length)
    return {
      url: null,
      reason: "DATABASE_NOT_CONFIGURED",
      source: null,
    };

  let mismatch = false;
  for (const [source, value] of configured) {
    try {
      const u = new URL(value);
      if (
        !["postgres:", "postgresql:"].includes(u.protocol) ||
        !u.hostname.endsWith(".pooler.supabase.com") ||
        u.port !== "6543" ||
        !u.username.startsWith("postgres.") ||
        !u.password ||
        u.pathname !== "/postgres" ||
        /[<>\s]/.test(value)
      )
        continue;

      if (
        env.SUPABASE_PROJECT_REF &&
        u.username !== `postgres.${env.SUPABASE_PROJECT_REF}`
      ) {
        mismatch = true;
        continue;
      }

      return { url: value, reason: null, source };
    } catch {
      // Tenta o próximo alias configurado sem expor a URL inválida.
    }
  }

  return {
    url: null,
    reason: mismatch
      ? "DB_PROJECT_REF_MISMATCH"
      : "INVALID_TRANSACTION_POOLER_URL",
    source: null,
  };
}

export function buildRuntime(env: NodeJS.ProcessEnv) {
  const appEnv = resolveAppEnv(env);
  const db = resolveDbUrl(env, appEnv);
  const configuredOrigins = (env.APP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        return new URL(origin).origin;
      } catch {
        return origin;
      }
    });

  const defaultDevOrigins =
    appEnv === "development"
      ? ["http://localhost:3000", "http://127.0.0.1:3000"]
      : [];

  const origins = Array.from(
    new Set([...configuredOrigins, ...defaultDevOrigins]),
  );

  return Object.freeze({
    appEnv,
    dbUrl: db.url,
    dbUrlSource: db.source,
    dbRejection: db.reason,
    dbUrlRejectionReason: db.reason,
    supabaseUrl: env.SUPABASE_URL ?? "",
    // Os aliases modernos permanecem como compatibilidade de deployment,
    // mas não fazem parte do contrato de secrets do Studio.
    anonKey:
      env.SUPABASE_ANON_KEY ??
      env[["SUPABASE", "PUBLISHABLE", "KEY"].join("_")] ??
      "",
    serviceKey:
      env.SUPABASE_SERVICE_ROLE_KEY ??
      env[["SUPABASE", "SECRET", "KEY"].join("_")] ??
      "",
    projectRef: env.SUPABASE_PROJECT_REF ?? "",
    ipPepper: env.APP_IP_PEPPER ?? "",
    outboxKey: env.OUTBOX_ENCRYPTION_KEY ?? "",
    commitSha: env.VERCEL_GIT_COMMIT_SHA ?? "",
    origins: Object.freeze(origins),
    secureCookies: appEnv !== "development",
    port: Number(env.PORT ?? 3000),
  });
}

export const runtime = buildRuntime(process.env);

export function logRuntimeBootSummary(
  current: ReturnType<typeof buildRuntime> = runtime,
) {
  let supabaseHost = "(missing)";
  try {
    if (current.supabaseUrl)
      supabaseHost = new URL(current.supabaseUrl).hostname;
  } catch {
    supabaseHost = "(invalid)";
  }

  console.log("[RUNTIME] Boot", {
    appEnv: current.appEnv,
    dbConfigured: Boolean(current.dbUrl),
    dbUrlSource: current.dbUrlSource,
    dbUrlRejectionReason: current.dbUrlRejectionReason,
    supabaseHost,
    hasServiceRole: Boolean(current.serviceKey),
    hasIpPepper: Boolean(current.ipPepper),
    hasOutboxKey: Boolean(current.outboxKey),
  });
}
