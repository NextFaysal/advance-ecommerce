/**
 * E2E SCAFFOLDING — admin order status transition. NOT RUN.
 * Requires: dev server, DB + Prisma client, seeded staff user, and a
 * seeded PENDING order. Env:
 *   E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_SEED_ORDER_ID
 * The transition under test is PENDING -> CONFIRMED, which the order
 * state machine allows; an invalid transition must be rejected by the
 * UI/API and is covered at unit level, not here.
 */
import { expect, test, type Page } from "@playwright/test";

const adminEmail = process.env["E2E_ADMIN_EMAIL"];
const adminPassword = process.env["E2E_ADMIN_PASSWORD"];
const orderId = process.env["E2E_SEED_ORDER_ID"];
const ready =
  typeof adminEmail === "string" &&
  typeof adminPassword === "string" &&
  typeof orderId === "string";

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel(/email \/ phone/i).fill(adminEmail as string);
  await page.getByLabel(/^password$/i).fill(adminPassword as string);
  await page.getByRole("button", { name: /^login$/i }).click();
  await expect(page).toHaveURL(/\/admin(\/)?($|\?)/, { timeout: 10_000 });
}

test.describe("admin order status transition", () => {
  test.skip(!ready, "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD / E2E_SEED_ORDER_ID not set");

  test("PENDING order can be confirmed from the order detail page", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/orders/${orderId as string}`);

    await expect(page.getByText(/PENDING/i).first()).toBeVisible({ timeout: 10_000 });

    // Next-step button in the detail shell (One-Click / status actions).
    await page
      .getByRole("button", { name: /confirm|কনফার্ম/i })
      .first()
      .click();

    await expect(page.getByText(/CONFIRMED/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/PENDING/i)).toHaveCount(0);
  });

  test("order list filters by status", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/orders");
    await expect(page.getByRole("heading", { name: /orders/i }).first()).toBeVisible({
      timeout: 10_000,
    });
    const pendingTab = page.getByRole("button", { name: /pending/i }).first();
    if ((await pendingTab.count()) > 0) {
      await pendingTab.click();
      await expect(page).toHaveURL(/status=PENDING|pending/i);
    }
  });
});
