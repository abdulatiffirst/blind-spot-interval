import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
process.env.PLAYWRIGHT_BROWSERS_PATH ??= "/tmp/blindspot-browsers";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    launchOptions: {
      ...(existsSync("/usr/bin/chromium")
        ? { executablePath: "/usr/bin/chromium" }
        : {}),
    },
  },
  webServer: [
    {
      command: "npm run dev:api",
      url: "http://localhost:3001/health",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev:web",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
