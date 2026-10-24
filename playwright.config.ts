/**
 * Playwright config — Agent 12 (E2E scaffolding, Step 36 base).
 *
 * SCAFFOLDING ONLY — these tests have NOT been run and must not be
 * reported as passing. Prerequisites before any run:
 *   1. Install the runner (not yet a dependency of this repo):
 *        pnpm add -Dw @playwright/test
 *        pnpm exec playwright install chromium
 *   2. Start the dev server with a working DB + generated Prisma client:
 *        cp apps/web/.env.example apps/web/.env.local   (fill local values)
 *        pnpm --filter web dev                          (http://localhost:3000)
 *   3. Seed data + test env (see tests/e2e/*.spec.ts headers):
 *        E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD,
 *        E2E_SEED_PRODUCT_SLUG, E2E_SEED_ORDER_ID (optional per spec)
 *
 * Projects: a 360px low-end Android-sized mobile viewport (the primary
 * BD admin device class) and a desktop viewport.
 */
import { defineConfig } from "@playwright/test";

const baseURL = process.env["E2E_BASE_URL"] ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "mobile-360",
      use: {
        viewport: { width: 360, height: 740 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (Linux; Android 13; Redmi Note 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
      },
    },
    {
      name: "desktop",
      use: {
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
      },
    },
  ],
  webServer: {
    // Reuse a server the developer already started; only auto-start in
    // a dedicated E2E environment where DB/env are known to be ready.
    command: "pnpm --filter web dev",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
