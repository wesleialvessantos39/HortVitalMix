import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { PwaVersionSchema } from "../shared/contracts/pwa.ts";

const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export function offlineWorkerPlugin(): Plugin {
  let outputDirectory = "dist";
  return {
    name: "hvm-rural-static-shell",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      outputDirectory = resolve(config.root, config.build.outDir);
    },
    // Rolldown finalizes import/hash placeholders AFTER generateBundle. Read the
    // actual written bytes, otherwise integrity hashes do not match deployment.
    writeBundle(options) {
      const out = options.dir ? resolve(options.dir) : outputDirectory;
      const files = new Map<string, Buffer>();
      const paths = [
        "index.html",
        "manifest.webmanifest",
        "favicon.svg",
        "app-icons/icon-192.png",
        "app-icons/icon-512.png",
        ...readdirSync(resolve(out, "assets"))
          .filter((path) => /\.(?:js|css)$/.test(path))
          .map((path) => "assets/" + path),
      ];
      for (const path of paths)
        files.set("/" + path, readFileSync(resolve(out, path)));
      const template = readFileSync(
        new URL("../src/lib/offline-worker.js", import.meta.url),
        "utf8",
      );
      const entries = () =>
        [...files]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([url, content]) => ({
            url,
            sha256: sha256(content),
            bytes: content.byteLength,
          }));
      // Identity includes actual bytes and worker semantics. Hash the final
      // shell below, after adding its identity, to avoid a self-referential hash.
      const buildId = sha256(template + JSON.stringify(entries()));
      const html = files
        .get("/index.html")!
        .toString("utf8")
        .replace(
          "</head>",
          `<meta name="hvm-pwa-build" content="${buildId}"/></head>`,
        );
      files.set("/index.html", Buffer.from(html));
      const pkg = JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      );
      const version = PwaVersionSchema.parse({
        format: 1,
        buildId,
        resourceIdentity: buildId,
        commitSha:
          process.env.VERCEL_GIT_COMMIT_SHA ||
          process.env.HVM_BUILD_COMMIT_SHA ||
          "",
        frontendVersion: pkg.version,
        publishedAt: null,
        resources: entries(),
      });
      const manifest = JSON.parse(
        files.get("/manifest.webmanifest")!.toString("utf8"),
      );
      if (
        manifest.name !== "HortiVitalMix" ||
        manifest.start_url !== "/" ||
        manifest.scope !== "/" ||
        manifest.display !== "standalone" ||
        ![192, 512].every((size) =>
          manifest.icons?.some(
            (icon: { src: string; sizes: string }) =>
              icon.sizes === `${size}x${size}` && files.has(icon.src),
          ),
        )
      )
        throw Error("PWA_MANIFEST_INVALID");
      const source = template
        .replace("__HVM_CACHE_NAME__", "hvm-rural-assets-" + buildId)
        .replace("__HVM_PWA_VERSION__", JSON.stringify(version));
      writeFileSync(resolve(out, "index.html"), html);
      writeFileSync(resolve(out, "offline-worker.js"), source);
      writeFileSync(resolve(out, "pwa-version.json"), JSON.stringify(version));
    },
  };
}
