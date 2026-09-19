import "dotenv/config";
import type { AppEnvironment } from "../../shared/contracts/foundation.ts";
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
): { url: string | null; reason: string | null } {
  if (appEnv !== "development" && (env.DATABASE_URL || env.POSTGRES_URL))
    return { url: null, reason: "LEGACY_DB_ALIAS_REJECTED" };
  const value =
    env.SUPABASE_DB_URL ||
    (appEnv === "development"
      ? env.DATABASE_URL || env.POSTGRES_URL
      : undefined);
  if (!value) return { url: null, reason: "DATABASE_NOT_CONFIGURED" };
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
      throw new Error();
    return { url: value, reason: null };
  } catch {
    return { url: null, reason: "INVALID_TRANSACTION_POOLER_URL" };
  }
}
export function buildRuntime(env: NodeJS.ProcessEnv) {
  const appEnv = resolveAppEnv(env),
    db = resolveDbUrl(env, appEnv);
  const origins = (
    env.APP_ALLOWED_ORIGINS ??
    (appEnv === "development"
      ? "http://localhost:3000,http://127.0.0.1:3000"
      : "")
  )
    .split(",")
    .filter(Boolean);
  return Object.freeze({
    appEnv,
    dbUrl: db.url,
    dbRejection: db.reason,
    supabaseUrl: env.SUPABASE_URL ?? "",
    anonKey: env.SUPABASE_ANON_KEY ?? "",
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    projectRef: env.SUPABASE_PROJECT_REF ?? "",
    ipPepper: env.APP_IP_PEPPER ?? "",
    commitSha: env.VERCEL_GIT_COMMIT_SHA ?? env.APP_COMMIT_SHA ?? "",
    origins: Object.freeze(origins),
    secureCookies: appEnv !== "development",
    port: Number(env.PORT ?? 3000),
  });
}
export const runtime = buildRuntime(process.env);
