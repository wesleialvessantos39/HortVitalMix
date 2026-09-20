import { runtime } from "../server/config/runtime.ts";

const PRODUCTION_PROJECT_REF = "xipbsazvymkqqfmfegwu";

if (runtime.appEnv !== "development") {
  console.error(
    "INTEGRATION_GATE_FAILED: homologate com integração real só pode rodar em development.",
  );
  process.exit(1);
}

if (!runtime.projectRef) {
  console.error(
    "INTEGRATION_GATE_FAILED: SUPABASE_PROJECT_REF é obrigatório.",
  );
  process.exit(1);
}

if (runtime.projectRef === PRODUCTION_PROJECT_REF) {
  console.error(
    "INTEGRATION_GATE_FAILED: project ref de production recusado.",
  );
  process.exit(1);
}

console.log("Integração real habilitada em development isolado.");
