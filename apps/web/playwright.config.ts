import { defineConfig, devices } from "@playwright/test";

/**
 * Runs against the fake farm. `pnpm e2e` boots fixtures, server (fresh in-memory DB) and web.
 * Ports are offset from `pnpm dev` so both can run at once.
 */
const SERVER = 3491;
const WEB = 5174;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${WEB}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    { command: "pnpm --filter @farmhand/fixtures start", port: 17125, reuseExistingServer: true },
    {
      command: "pnpm --filter @farmhand/server exec node --import tsx src/index.ts",
      port: SERVER,
      reuseExistingServer: false,
      env: {
        NODE_ENV: "test",
        FARMHAND_PORT: String(SERVER),
        FARMHAND_PUBLIC_URL: `http://localhost:${WEB}`,
        FARMHAND_DB: ":memory:",
        BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-0000",
        FARMHAND_DEV_ALLOW_LOOPBACK: "1",
        FARMHAND_HELPER: "fake",
        FARMHAND_FAKE_HELPER_DIR: ".farmhand-e2e-helper",
        FARMHAND_LAN_IP: "10.0.0.2",
        PRINTSTASH_URL: "http://127.0.0.1:13460",
        PRINTSTASH_USER: "fixture",
        PRINTSTASH_PASSWORD: "fixture-password",
        FDM_URL: "http://127.0.0.1:14000",
        FDM_USER: "fixture",
        FDM_PASSWORD: "fixture-password",
        SPOOLMAN_URL: "http://127.0.0.1:17912",
        ORCASLICER_URL: "http://127.0.0.1:1",
      },
    },
    {
      command: `pnpm --filter @farmhand/web exec vite --port ${WEB} --strictPort`,
      port: WEB,
      reuseExistingServer: false,
      env: { FARMHAND_API_PORT: String(SERVER) },
    },
  ],
});
