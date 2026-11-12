import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  use: {
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
    baseURL: "http://127.0.0.1:8091",
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: "npx tsx tests/e2e-server.ts",
    url: "http://127.0.0.1:8091/health",
    reuseExistingServer: false,
  },
});
