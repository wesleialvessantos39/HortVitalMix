import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Script } from "node:vm";
import { PwaVersionSchema } from "../shared/contracts/pwa.ts";

const version = PwaVersionSchema.parse(
  JSON.parse(readFileSync("dist/pwa-version.json", "utf8")),
);
for (const resource of version.resources) {
  const bytes = readFileSync("dist" + resource.url);
  if (
    bytes.byteLength !== resource.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== resource.sha256
  )
    throw Error("PWA_RESOURCE_INTEGRITY_FAILED: " + resource.url);
}
const manifest = JSON.parse(readFileSync("dist/manifest.webmanifest", "utf8"));
if (
  manifest.name !== "HortiVitalMix" ||
  manifest.display !== "standalone" ||
  manifest.scope !== "/" ||
  manifest.start_url !== "/"
)
  throw Error("PWA_MANIFEST_INVALID");
for (const size of [192, 512]) {
  const icon = manifest.icons.find(
    (entry: { sizes: string }) => entry.sizes === `${size}x${size}`,
  );
  if (!icon || icon.src !== `/app-icons/icon-${size}.png`)
    throw Error("PWA_ICON_INVALID");
  const png = readFileSync("dist" + icon.src);
  if (
    png.toString("hex", 0, 8) !== "89504e470d0a1a0a" ||
    png.readUInt32BE(16) !== size ||
    png.readUInt32BE(20) !== size
  )
    throw Error("PWA_ICON_DIMENSIONS_INVALID");
}
const shell = readFileSync("dist/index.html", "utf8");
if (
  !shell.includes(`name="hvm-pwa-build" content="${version.buildId}"`) ||
  !shell.includes('rel="manifest"') ||
  !shell.includes('rel="apple-touch-icon"')
)
  throw Error("PWA_SHELL_LINKS_INVALID");
const worker = readFileSync("dist/offline-worker.js", "utf8");
new Script(worker);
if (worker.includes("__HVM_") || !worker.includes(version.buildId))
  throw Error("PWA_WORKER_NOT_GENERATED");
const config = JSON.parse(readFileSync("vercel.json", "utf8"));
for (const path of ["/offline-worker.js", "/pwa-version.json"]) {
  const entry = config.headers.find(
    (value: { source: string }) => value.source === path,
  );
  if (
    !entry?.headers.some(
      (value: { key: string; value: string }) =>
        value.key === "Cache-Control" && value.value.includes("no-store"),
    )
  )
    throw Error("PWA_VERSION_CACHE_UNSAFE");
}
console.log(
  JSON.stringify({
    status: "verified",
    commitSha: version.commitSha,
    buildId: version.buildId,
    resources: version.resources.length,
    icons: [192, 512],
    privateResources: 0,
  }),
);
