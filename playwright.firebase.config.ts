import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
process.env.PLAYWRIGHT_BROWSERS_PATH ??= "/tmp/blindspot-browsers";
if (
  process.env.GCLOUD_PROJECT !== "demo-blind-spot-interval" ||
  !["127.0.0.1:8080", "localhost:8080"].includes(
    process.env.FIRESTORE_EMULATOR_HOST ?? "",
  ) ||
  !["127.0.0.1:9099", "localhost:9099"].includes(
    process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "",
  )
)
  throw new Error("Run Firebase E2E through the demo emulator runner");
export default defineConfig({
  testDir: "tests/firebase-e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 90000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "http://localhost:5174",
    trace: "retain-on-failure",
    launchOptions: existsSync("/usr/bin/chromium")
      ? { executablePath: "/usr/bin/chromium" }
      : {},
  },
  webServer: {
    command: "npm run dev:web:firebase",
    url: "http://localhost:5174",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
