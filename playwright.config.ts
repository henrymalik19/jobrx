// End-to-end tests: the real app in Chrome, against the local Supabase stack, as a test user of its own
// (tests/e2e/local.ts). Needs `pnpm db:start`; runs with `pnpm test:e2e`.
import { defineConfig } from "@playwright/test";
import { E2E_PORT } from "./tests/e2e/local";

const STATE = "tests/e2e/.auth/user.json";

export default defineConfig({
  testDir: "tests/e2e",
  // The test user is made before the tests and removed after them.
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  // One test user, so one test at a time.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  // The dev server compiles each page the first time it's opened.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    channel: "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "sign-in", testMatch: /sign-in\.setup\.ts/ },
    { name: "app", testMatch: /\.spec\.ts/, dependencies: ["sign-in"], use: { storageState: STATE } },
  ],
  webServer: {
    command: "node --import tsx tests/e2e/serve.ts",
    url: `http://localhost:${E2E_PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
