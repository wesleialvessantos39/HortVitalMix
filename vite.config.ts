import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  for (const [k, v] of Object.entries(env))
    if (process.env[k] === undefined) process.env[k] = v;
  return {
    plugins: [
      react(),
      {
        name: "hortivitalmix-same-origin-api",
        async configureServer(server) {
          const { app } = await import("./server/app.ts");
          server.middlewares.use("/api", app);
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
