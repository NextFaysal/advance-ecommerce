/**
 * E2E SCAFFOLDING — storefront product list. NOT RUN.
 * Requires: dev server on http://localhost:3000. Works best with the
 * seed/sample catalog; with an empty DB the empty-state test is the
 * meaningful one. Selectors use roles/text for now — tighten them to
 * data-testid attributes when those land on the product components.
 */
import { expect, test } from "@playwright/test";

test.describe("storefront product list", () => {
  test("shop page loads and shows products or an honest empty state", async ({ page }) => {
    await page.goto("/shop");
    await expect(page).toHaveTitle(/.+/);

    const productLinks = page.locator('a[href^="/product/"]');
    const emptyState = page.getByText(/no products|kono product|পণ্য নেই/i);
    await expect(productLinks.first().or(emptyState)).toBeVisible({ timeout: 10_000 });
  });

  test("search with a Banglish term returns a result or a no-result state", async ({ page }) => {
    await page.goto("/search?q=sharee");
    const productLinks = page.locator('a[href^="/product/"]');
    const noResult = page.getByText(/no result|kichu pawa jay ni|পাওয়া যায়নি/i);
    await expect(productLinks.first().or(noResult)).toBeVisible({ timeout: 10_000 });
  });

  test("product detail opens from the list when a product exists", async ({ page }) => {
    await page.goto("/shop");
    const firstProduct = page.locator('a[href^="/product/"]').first();
    if ((await firstProduct.count()) === 0) {
      test.skip(true, "No products in this environment (empty catalog)");
    }
    await firstProduct.click();
    await expect(page).toHaveURL(/\/product\//);
    // Price must render in BDT from integer poisha — never a float artifact.
    await expect(page.getByText(/৳/).first()).toBeVisible();
    await expect(page.getByText(/\.\d{3,}/).first()).toHaveCount(0);
  });
});
