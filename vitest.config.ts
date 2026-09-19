import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/setup/globalSetup.ts"],
    globalSetup: ["./tests/setup/startup.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: "forks",
    isolate: true,
    sequence: {
      shuffle: false,
    },
    coverage: {
      include: ["server/**/*.ts", "shared/**/*.ts", "tests/helpers/**/*.ts"],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
        "server/config/runtime.ts": { lines: 80 },
        "server/config/reportFailure.ts": { lines: 90 },
        "server/routes/foundationRoutes.ts": { lines: 80 },
        "shared/contracts/**": { lines: 100 },
        "tests/helpers/**": { lines: 70 },
      },
    },
  },
});
