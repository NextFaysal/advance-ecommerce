/**
 * E2E SCAFFOLDING — admin login flow. NOT RUN.
 * Requires: dev server on http://localhost:3000, DB + Prisma client,
 * a seeded staff user, and env:
 *   E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD
 * The whole suite skips when those env vars are missing — it never
 * hardcodes a credential. If the seeded user has 2FA enabled, the
 * happy-path test needs a TOTP step added once enrolment lands.
 */
import { expect, test } from "@playwright/test";

const adminEmail = process.env["E2E_ADMIN_EMAIL"];
const adminPassword = process.env["E2E_ADMIN_PASSWORD"];
const hasCreds = typeof adminEmail === "string" && typeof adminPassword === "string";

test.describe("admin login", () => {
  test.skip(!hasCreds, "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set");

  test("staff can log in and reach /admin", async ({ page }) => {
    await page.goto("/admin/login");
    await expect(page.getByRole("heading", { name: /admin login/i })).toBeVisible();

    await page.getByLabel(/email \/ phone/i).fill(adminEmail as string);
    await page.getByLabel(/^password$/i).fill(adminPassword as string);
    await page.getByRole("button", { name: /^login$/i }).click();

    // Login page redirects to /admin on success (or shows the TOTP step).
    await expect(page).toHaveURL(/\/admin(\/)?($|\?)/, { timeout: 10_000 });
  });

  test("wrong password shows a generic error, never 'user not found'", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel(/email \/ phone/i).fill(adminEmail as string);
    await page.getByLabel(/^password$/i).fill("wrong-password-123");
    await page.getByRole("button", { name: /^login$/i }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText(/not found|no such user/i);
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("unauthenticated /admin redirects to login (middleware)", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
