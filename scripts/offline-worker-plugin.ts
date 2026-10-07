import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";
export function offlineWorkerPlugin(): Plugin {
  return {
    name: "hvm-rural-static-shell",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const assets = [
        "/index.html",
        ...Object.keys(bundle)
          .filter((p) => p.startsWith("assets/") && /\.(?:js|css)$/.test(p))
          .map((p) => "/" + p),
      ].sort();
      const revision = createHash("sha256")
        .update(assets.join("\n"))
        .update(
          bundle["index.html"]?.type === "asset"
            ? String(bundle["index.html"].source)
            : readFileSync(new URL("../index.html", import.meta.url), "utf8"),
        )
        .digest("hex")
        .slice(0, 16);
      const source = readFileSync(
        new URL("../src/lib/offline-worker.js", import.meta.url),
        "utf8",
      )
        .replace("__HVM_CACHE_NAME__", "hvm-rural-assets-" + revision)
        .replace("__HVM_STATIC_ASSETS__", JSON.stringify(assets));
      this.emitFile({ type: "asset", fileName: "offline-worker.js", source });
    },
  };
}
