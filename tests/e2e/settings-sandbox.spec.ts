/**
 * E2E SCAFFOLDING — admin settings sandbox test. NOT RUN.
 * Requires: dev server, DB + Prisma client (settings routes return
 * 503 DB_NOT_READY until Prisma generate succeeds), seeded staff user
 * with settings.integrations permission. Env:
 *   E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD
 * Contract under test (POST /api/v1/admin/settings/test): sandbox mode
 * passes as a SIMULATED test; live mode must never fake success, and no
 * credential value may ever appear in the page or the API response.
 */
import { expect, test, type Page } from "@playwright/test";

const adminEmail = process.env["E2E_ADMIN_EMAIL"];
const adminPassword = process.env["E2E_ADMIN_PASSWORD"];
const hasCreds = typeof adminEmail === "string" && typeof adminPassword === "string";

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel(/email \/ phone/i).fill(adminEmail as string);
  await page.getByLabel(/^password$/i).fill(adminPassword as string);
  await page.getByRole("button", { name: /^login$/i }).click();
  await expect(page).toHaveURL(/\/admin(\/)?($|\?)/, { timeout: 10_000 });
}

test.describe("admin settings — sandbox test connection", () => {
  test.skip(!hasCreds, "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set");

  test("payments settings page loads with provider cards, no credential values", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/settings/payments");
    await expect(page.getByText(/bkash/i).first()).toBeVisible({ timeout: 10_000 });
    // Credential fields are write-only references: the page must not
    // render any stored secret value back to the browser.
    await expect(page.locator("body")).not.toContainText(/credential value|api[_-]?secret\s*[:=]\s*\S+/i);
  });

  test("sandbox test for a payment provider reports a simulated pass", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/settings/payments");

    const testButton = page.getByRole("button", { name: /test/i }).first();
    await expect(testButton).toBeVisible({ timeout: 10_000 });
    await testButton.click();

    // Sandbox contract: simulated pass is labelled as sandbox/simulated,
    // never presented as a real provider connection.
    await expect(
      page.getByText(/sandbox test passed|simulated|স্যান্ডবক্স/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("settings test API rejects unauthenticated calls", async ({ request }) => {
    const res = await request.post("/api/v1/admin/settings/test", {
      data: { category: "payment", provider: "bkash" },
    });
    expect([401, 403]).toContain(res.status());
  });
});
