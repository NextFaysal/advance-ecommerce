/**
 * Regression guard — public payloads must NEVER contain costPoisha.
 *
 * Privacy fix 2026-10-24: list pages used to pass full repository
 * Product objects into client-component props (ProductCard), so variant
 * cost prices rode the RSC payload to public browsers even though the
 * UI never displayed them. The public read path now shapes every
 * product through toPublicProduct (src/catalog/server-read.ts:
 * listActivePublicProducts / listPublicProducts).
 *
 * This script runs the SAME helpers the public pages use against the
 * local DB and deep-scans the returned graphs for a `costPoisha` key
 * anywhere. It also asserts the ADMIN read path still returns cost
 * (staff pages legitimately need it), and that the check is not
 * vacuous: the seeded sample product is temporarily flipped
 * DRAFT -> ACTIVE so the public list is non-empty, then restored.
 *
 * Run (from apps/web):
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/advance_ecommerce \
 *     ./node_modules/.bin/tsx scripts/check-public-payload.ts
 * Exits non-zero on any failure.
 */
import { prisma } from "@advance-ecommerce/db";
import {
  listActiveProducts,
  listActivePublicProducts,
  listPublicProducts,
} from "../src/catalog/server-read";
import { buildLandingViewModel } from "../src/landing/render";
import type { LandingPage } from "../src/landing/types";

function findCostKeys(value: unknown, path = "$", hits: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((v, i) => findCostKeys(v, `${path}[${i}]`, hits));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "costPoisha") hits.push(`${path}.${k}`);
      findCostKeys(v, `${path}.${k}`, hits);
    }
  }
  return hits;
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function main() {
  // Find the seeded sample product (DRAFT in seed state) and flip it
  // ACTIVE so the public helpers return a non-empty graph.
  const sample = await prisma.product.findFirst({
    where: { deletedAt: null },
    select: { id: true, slug: true, status: true },
  });
  if (!sample) throw new Error("no product in DB — seed first");
  const originalStatus = sample.status;
  await prisma.product.update({ where: { id: sample.id }, data: { status: "ACTIVE" } });

  try {
    // ADMIN path: full shape, cost present (proves the source data
    // really carries cost, so the public strip below is not vacuous).
    const adminList = await listActiveProducts(100);
    const adminHits = findCostKeys(adminList);
    check("admin listActiveProducts returns products", adminList.length > 0, `${adminList.length} product(s)`);
    check("admin path still carries costPoisha (staff)", adminHits.length > 0, `${adminHits.length} key(s), e.g. ${adminHits[0] ?? "none"}`);

    // PUBLIC home / cart / lp helper.
    const publicList = await listActivePublicProducts(100);
    const publicHits = findCostKeys(publicList);
    check("listActivePublicProducts non-empty", publicList.length > 0, `${publicList.length} product(s)`);
    check("listActivePublicProducts has NO costPoisha anywhere", publicHits.length === 0, publicHits[0] ?? "clean");

    // PUBLIC shop/search helper, unfiltered and by the product's slug term.
    const shopAll = await listPublicProducts({ page: 1, pageSize: 100 });
    const shopHits = findCostKeys(shopAll);
    check("listPublicProducts non-empty", shopAll.products.length > 0, `${shopAll.products.length} product(s)`);
    check("listPublicProducts has NO costPoisha anywhere", shopHits.length === 0, shopHits[0] ?? "clean");

    // Landing /lp: view model built from the public list (as the page does).
    const fakePage: LandingPage = {
      id: "smoke",
      slug: "smoke",
      titleBn: "smoke",
      titleEn: "smoke",
      status: "PUBLISHED",
      sections: [
        {
          id: "s1",
          type: "product_offer",
          productId: publicList[0]!.id,
          variantId: publicList[0]!.variants[0]?.id ?? null,
          discountNoteBn: "",
          discountNoteEn: "",
          showCountdown: false,
          countdownEndsAt: null,
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as unknown as LandingPage;
    const view = buildLandingViewModel(fakePage, publicList);
    const viewHits = findCostKeys(view);
    check("landing view model resolves the offer", view.primaryOffer !== null);
    check("landing view model has NO costPoisha anywhere", viewHits.length === 0, viewHits[0] ?? "clean");
  } finally {
    await prisma.product.update({ where: { id: sample.id }, data: { status: originalStatus } });
    const restored = await prisma.product.findUnique({ where: { id: sample.id }, select: { status: true } });
    check("seed product status restored", restored?.status === originalStatus, `status=${restored?.status}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll public-payload cost checks passed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
