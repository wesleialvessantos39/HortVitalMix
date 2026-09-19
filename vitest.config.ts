import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      include: ["server/**/*.ts", "shared/**/*.ts"],
      thresholds: { lines: 60, functions: 60, branches: 50, statements: 60 },
    },
  },
});
