import { runtime } from "../server/config/runtime.ts";
if (
  process.env.RUN_SUPABASE_INTEGRATION !== "1" ||
  runtime.appEnv !== "development" ||
  process.env.SUPABASE_TEST_PROJECT_REF !== runtime.projectRef
) {
  console.error(
    "Homologação exige testes reais habilitados em ambiente development isolado.",
  );
  process.exit(1);
}
