import { runtime } from "../server/config/runtime.ts";

if (process.env.HVM_INTEGRATION_ENABLED !== "true") {
  console.error(
    "INTEGRATION_GATE_FAILED: defina HVM_INTEGRATION_ENABLED=true somente para a homologação real.",
  );
  process.exit(1);
}

if (runtime.appEnv !== "development") {
  console.error(
    "INTEGRATION_GATE_FAILED: homologação com integração real só pode rodar em development.",
  );
  process.exit(1);
}

if (!runtime.projectRef) {
  console.error(
    "INTEGRATION_GATE_FAILED: SUPABASE_PROJECT_REF é obrigatório.",
  );
  process.exit(1);
}

const productionProjectRef = process.env.HVM_PROD_PROJECT_REF ?? "";

if (!productionProjectRef) {
  console.error(
    "INTEGRATION_GATE_FAILED: HVM_PROD_PROJECT_REF é obrigatório para impedir testes contra production.",
  );
  process.exit(1);
}

if (runtime.projectRef === productionProjectRef) {
  console.error(
    "INTEGRATION_GATE_FAILED: project ref de production recusado.",
  );
  process.exit(1);
}

console.log("Integração real habilitada em development isolado.");
