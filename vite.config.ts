import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import type { Request, Response } from "express";
import { offlineWorkerPlugin } from "./scripts/offline-worker-plugin.ts";
import { execFileSync } from "node:child_process";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  for (const [k, v] of Object.entries(env))
    if (process.env[k] === undefined) process.env[k] = v;
  if (!process.env.VERCEL_GIT_COMMIT_SHA && !process.env.HVM_BUILD_COMMIT_SHA) {
    try { process.env.HVM_BUILD_COMMIT_SHA = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* Source archive has no Git identity. */ }
  }
  return {
    define: {
      __HVM_BUILD_COMMIT_SHA__: JSON.stringify(
        process.env.VERCEL_GIT_COMMIT_SHA || process.env.HVM_BUILD_COMMIT_SHA || "",
      ),
    },
    plugins: [
      react(),
      offlineWorkerPlugin(),
      {
        name: "hortivitalmix-same-origin-api",
        async configureServer(server) {
          const { app } = await import("./server/app.ts");
          // Google AI Studio pode executar o projeto pelo servidor de
          // desenvolvimento. Mantemos os dois prefixos compatíveis.
          server.middlewares.use("/_hvm_api", app);
          server.middlewares.use("/api", app);
          server.middlewares.use("/downloads", (req, res, next) => {
            req.url = "/downloads" + req.url;
            app(req as Request, res as Response, next);
          });
        },
        async configurePreviewServer(server) {
          const { app } = await import("./server/app.ts");
          // O preview de produção do Google Studio não executa
          // configureServer. Sem este hook, o frontend abre normalmente mas
          // POSTs administrativos retornam 404/rede antes de chegar ao backend.
          server.middlewares.use("/_hvm_api", app);
          server.middlewares.use("/api", app);
          server.middlewares.use("/downloads", (req, res, next) => {
            req.url = "/downloads" + req.url;
            app(req as Request, res as Response, next);
          });
        },
      },
    ],
    server: {
      host: "0.0.0.0",
      port: 3000,
      strictPort: true,
      hmr: process.env.DISABLE_HMR !== "true",
      watch: process.env.DISABLE_HMR === "true" ? null : {},
    },
    build: { sourcemap: false },
  };
});
