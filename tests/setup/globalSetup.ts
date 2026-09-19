import { beforeAll } from "vitest";

export function assertNotProduction() {
  const url = process.env.SUPABASE_DB_URL ?? "";
  const appEnv = process.env.APP_ENV ?? "";
  const vercelEnv = process.env.VERCEL_ENV ?? "";
  const projectRef = process.env.SUPABASE_PROJECT_REF ?? "";
  const prodRef = process.env.HVM_PROD_PROJECT_REF ?? "";

  if (appEnv === "production" || vercelEnv === "production") {
    throw new Error("[TEST] Ambiente production recusado.");
  }

  for (const pattern of [/prod/i, /production/i]) {
    if (pattern.test(url)) {
      throw new Error(
        `[TEST] SUPABASE_DB_URL parece apontar para produção (${pattern}).`,
      );
    }
  }

  if (prodRef && (url.includes(prodRef) || projectRef === prodRef)) {
    throw new Error("[TEST] Project ref de production recusado.");
  }
}

beforeAll(() => {
  assertNotProduction();
});

export const HAS_INTEGRATION =
  process.env.HVM_INTEGRATION_ENABLED === "true";
