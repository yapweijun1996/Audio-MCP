import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  timeout: 65000,
  expect: { timeout: 12000 },
  workers: 2,
  use: { baseURL: "http://127.0.0.1:4186", trace: "retain-on-failure" },
  outputDir: "../dist/browser-results",
  webServer: {
    command: "node scripts/serve-studio.mjs",
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    url: "http://127.0.0.1:4186",
    env: { STUDIO_PORT: "4186" },
    reuseExistingServer: false,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium", viewport: { width: 1440, height: 960 } },
    },
    {
      name: "mobile-webkit",
      testIgnore: "update.spec.mjs",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
    { name: "firefox", testIgnore: "update.spec.mjs", use: { browserName: "firefox" } },
  ],
});
