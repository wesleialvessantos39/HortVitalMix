import { defineConfig } from "@playwright/test";
const portable =
  process.env.HVM_PORTABLE_CHROMIUM === "1"
    ? (await import("@sparticuz/chromium")).default
    : null;
export default defineConfig({
  testDir: "tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:3000",
    browserName: "chromium",
    launchOptions: portable
      ? {
          executablePath:
            process.env.HVM_CHROMIUM_PATH ?? (await portable.executablePath()),
          args: ["--disable-gpu", "--no-zygote"],
        }
      : {},
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:3000/api/health",
    reuseExistingServer: true,
  },
  reporter: "list",
});
