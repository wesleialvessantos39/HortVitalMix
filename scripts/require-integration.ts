import { runtime } from "../server/config/runtime.ts";

const enabled = process.env.HVM_INTEGRATION_ENABLED === "true";
const productionRef = process.env.HVM_PROD_PROJECT_REF ?? "";

if (!enabled) {
  console.error(
    "INTEGRATION_GATE_FAILED: defina HVM_INTEGRATION_ENABLED=true para homologar development.",
  );
  process.exit(1);
}

if (runtime.appEnv !== "development") {
  console.error(
    "INTEGRATION_GATE_FAILED: homologate com integração real só pode rodar em development.",
  );
  process.exit(1);
}

if (productionRef && runtime.projectRef === productionRef) {
  console.error(
    "INTEGRATION_GATE_FAILED: project ref de production recusado.",
  );
  process.exit(1);
}

console.log("Integração real habilitada em development isolado.");
