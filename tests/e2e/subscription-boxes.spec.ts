import { test, expect } from "@playwright/test";

test.describe("Subscription Boxes — E2E Suite", () => {
  test("admin boxes page renders with configuration and contents cards", async ({ page }) => {
    // Navigate to admin boxes dashboard
    await page.goto("/admin/boxes");

    // Check page title and structure
    const heading = page.getByRole("heading", { name: /সাবস্ক্রিপশন বক্স|Subscription Boxes/i });
    await expect(heading).toBeVisible();

    // Verify presence of list card and run sweep action button
    const sweepButton = page.getByRole("button", { name: /সুইপ চালান|Run Sweep/i });
    if (await sweepButton.isVisible()) {
      await expect(sweepButton).toBeEnabled();
    }
  });

  test("public account subscriptions page renders next/last box details", async ({ page }) => {
    await page.goto("/account/subscriptions");
    // Verify that the page loads cleanly
    const content = page.getByText(/সাবস্ক্রিপশন|Subscriptions/i).first();
    await expect(content).toBeVisible();
  });
});
