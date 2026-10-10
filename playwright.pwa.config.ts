import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/pwa",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 20000 },
  use: {
    baseURL: "http://127.0.0.1:4174",
    browserName: "chromium",
    launchOptions: {
      executablePath: process.env.HVM_CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--disable-gpu", "--no-zygote"],
    },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node scripts/pwa-test-server.mjs",
    url: "http://127.0.0.1:4174/pwa-version.json",
    reuseExistingServer: false,
  },
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/pwa-results.json" }],
  ],
});
