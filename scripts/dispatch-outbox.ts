import { randomUUID } from "node:crypto";
import { dbPool } from "../server/db/pool.ts";
import { CommunicationOutboxService } from "../server/services/CommunicationOutboxService.ts";

async function main() {
  const batch = Number(process.argv[2] ?? "20");
  if (!dbPool) {
    console.error("[DISPATCH] dbPool indisponível.");
    process.exit(1);
  }
  const result = await CommunicationOutboxService.dispatchDue(batch, randomUUID());
  console.log("[DISPATCH]", result);
  await dbPool.end();
}

main().catch((error) => {
  console.error("[DISPATCH] Falha:", error instanceof Error ? error.message : "unknown");
  process.exit(1);
});
