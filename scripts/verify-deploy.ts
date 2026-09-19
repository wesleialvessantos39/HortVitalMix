import { parseArgs } from "./args.ts";
import {
  ApiHealthResponseSchema,
  ApiReadyResponseSchema,
  GlobalConfigPublicSchema,
} from "../shared/contracts/foundation.ts";
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (
    !args.url ||
    !/^https:\/\//.test(args.url) ||
    !/^[a-f0-9]{40}$/.test(args.sha ?? "")
  )
    throw new Error("INVALID_DEPLOY_ARGUMENTS");
  const url = args.url.replace(/\/$/, "");
  for (const [path, schema] of [
    ["health", ApiHealthResponseSchema],
    ["ready", ApiReadyResponseSchema],
    ["v1/config", GlobalConfigPublicSchema],
  ] as const) {
    const r = await fetch(url + "/api/" + path, {
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok || !r.headers.get("x-request-id"))
      throw new Error("DEPLOY_NOT_READY");
    const data = schema.parse(await r.json());
    if (path === "ready") {
      const ready = ApiReadyResponseSchema.parse(data);
      if (
        ready.schemaVersion !== Number(args.schema ?? 10) ||
        !ready.databaseConnected ||
        ready.status !== "ready" ||
        !ready.releaseTag.includes(args.sha.slice(0, 7))
      )
        throw new Error("DEPLOY_RELEASE_MISMATCH");
    }
  }
  console.log("Deployment verificado: health, ready e config.");
}
main().catch(() => {
  console.error("DEPLOY_VERIFICATION_FAILED");
  process.exitCode = 1;
});
