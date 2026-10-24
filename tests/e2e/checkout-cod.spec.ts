/**
 * E2E SCAFFOLDING — guest checkout with COD (MOCK). NOT RUN.
 * This exercises the checkout *flow* only. It requires:
 *   - dev server on http://localhost:3000, DB + Prisma client, and the
 *     order API wired to the DB (currently routes are in-memory/mock
 *     until Prisma generate succeeds) — until then a "placed" order is
 *     NOT persisted and this spec is expected to be adapted to the
 *     mock response shape.
 *   - env: E2E_SEED_PRODUCT_SLUG (a purchasable, in-stock product)
 * No payment gateway is touched: payment method is COD only.
 */
import { expect, test } from "@playwright/test";

const slug = process.env["E2E_SEED_PRODUCT_SLUG"];

test.describe("checkout — COD (mock)", () => {
  test.skip(typeof slug !== "string", "E2E_SEED_PRODUCT_SLUG not set");

  test("guest can place a COD order with a BD phone", async ({ page }) => {
    await page.goto(`/product/${slug as string}`);

    // Product page -> checkout. Button labels follow the storefront
    // components; adjust when data-testid attributes land.
    const orderNow = page.getByRole("button", { name: /order now|অর্ডার করুন|checkout/i }).first();
    await orderNow.click();
    await expect(page).toHaveURL(/\/checkout/, { timeout: 10_000 });

    await page.getByLabel(/name|নাম/i).first().fill("E2E Customer");
    // BD mobile format 01[3-9]XXXXXXXX (test number, not a real subscriber).
    await page.getByLabel(/phone|ফোন|মোবাইল/i).first().fill("01700000000");
    await page.getByLabel(/address|ঠিকানা/i).first().fill("House 1, Road 1, Dhanmondi, Dhaka");

    // Address hierarchy selects exist in the checkout form (Division >
    // District > Upazila). Fill the first enabled option of each when
    // present; geo seed is sample-only today, so this stays defensive.
    const selects = page.locator("select");
    const selectCount = await selects.count();
    for (let i = 0; i < selectCount; i += 1) {
      const select = selects.nth(i);
      if (await select.isEnabled()) {
        const options = await select.locator("option").all();
        if (options.length > 1) {
          const value = await options[1]?.getAttribute("value");
          if (value) await select.selectOption(value);
        }
      }
    }

    // COD is the default/manual payment path in the mock flow.
    const cod = page.getByLabel(/cash on delivery|ক্যাশ অন ডেলিভারি|cod/i).first();
    if ((await cod.count()) > 0) await cod.check().catch(async () => cod.click());

    await page.getByRole("button", { name: /place order|অর্ডার কনফার্ম|confirm/i }).first().click();

    // Confirmation shows an order number (ORD-...) or a success message.
    await expect(
      page.getByText(/ORD-\d+|order placed|অর্ডার.*সফল|ধন্যবাদ/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("checkout rejects an invalid BD phone", async ({ page }) => {
    await page.goto("/checkout");
    const phone = page.getByLabel(/phone|ফোন|মোবাইল/i).first();
    if ((await phone.count()) === 0) test.skip(true, "Checkout form not reachable without a cart");
    await phone.fill("01200000000"); // 012 is not a valid BD mobile prefix.
    await page.getByRole("button", { name: /place order|confirm/i }).first().click();
    await expect(page.getByText(/phone|ফোন/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/checkout/);
  });
});
