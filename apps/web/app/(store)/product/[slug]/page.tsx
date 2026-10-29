import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fromPoisha } from "@advance-ecommerce/validators";
import { getLivePublicProductBySlug, tryCatalogRepository } from "@/catalog/server-read";
import { maxVariantPricePoisha, minVariantPricePoisha, toPublicProduct } from "@/catalog/types";
import { LOW_STOCK_THRESHOLD, socialProofEnabled } from "@/marketing/social-proof";
import { getBoxPdpData } from "@/boxes/service";
import { getPodPdpNote } from "@/pod/customisation";
import { getCoursePdpData } from "@/courses/service";
import { getRelatedProducts } from "@/catalog/related";
import {
  bundleAvailabilityState,
  productTypeOf,
  type PublicProductWithTypeFields,
} from "@/catalog/product-type-contract";
import type { RecentlyViewedEntry } from "@/storefront-ux/types";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { resolvePdpPackSizeChart } from "@/business-modules/fashion-wiring";
import { getAgeRestrictionForCategorySlug } from "@/catalog/age-restrictions";
import { getWeightedInfosForProduct } from "@/business-modules/grocery-pricing";
import { getThemeSlots, AURORA_SLOTS } from "@/themes/slot-registry";
import { resolveStorefrontThemeFromStore } from "@/themes/resolution-server";
import { ThemeBoundary } from "@/themes/theme-boundary";
import type { PdpCompositionProps } from "@/themes/slots";

// Data: real catalog DB via the repository PUBLIC read path
// (ACTIVE-only) — a DRAFT/ARCHIVED slug 404s exactly like a missing one.
// Design refresh (Direction A): gallery + sticky buy box + trust rows.
// Presentation only — data flow, cart contracts and child components
// are unchanged.
export const revalidate = 60;
// PDP speed fix (2026-10-29): under the default dynamic mode this
// route silently opted out of static generation (no prerendered
// routes in the manifest, no-store at runtime) even though no code
// in the render path reads request state — a defensive dynamic-API
// probe somewhere in the tree poisons the route. Content parity
// between a force-static prerender and a dynamic render was
// verified identical (visible text, demo catalogue), so pin the
// intended ISR behaviour explicitly.
export const dynamic = "force-static";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const product = await getLivePublicProductBySlug(params.slug);
  if (!product) return { title: "পণ্য পাওয়া যায়নি" };
  const title = product.seoTitle?.bn ?? product.title.bn;
  const description = product.seoDescription?.bn ?? product.description.bn;
  // Share image: the product's dedicated OG image wins; otherwise the
  // first gallery image (images arrive sorted by sortOrder).
  const shareImage = product.ogImage ?? product.images[0]?.url;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      ...(shareImage ? { images: [{ url: shareImage, alt: product.title.bn }] } : {}),
    },
    twitter: {
      card: shareImage ? "summary_large_image" : "summary",
      title,
      description,
      ...(shareImage ? { images: [shareImage] } : {}),
    },
  };
}

// Wave S3b (doc 25): the arrangement JSX that used to live below —
// including the StarRow / TRUST_ROWS helpers — moved verbatim into
// the Aurora PdpComposition slot (src/themes/aurora/pdp-composition.tsx).
// This page keeps ALL data fetching and every derived display value
// and hands them to the resolved composition (see the return).

export default async function ProductPage({ params }: { params: { slug: string } }) {
  const repo = await tryCatalogRepository();
  const raw = await getLivePublicProductBySlug(params.slug);
  if (!raw) notFound();
  // Wave 15-3: 360° spin viewer (module.product_extras) for products
  // with enough gallery frames to spin.
  await ensureDbFeatureFlags();
  const spinEnabled = isFeatureEnabled("module.product_extras") && raw.images.length >= 6;
  // Public view: costPoisha stripped — never render cost to customers.
  const product = toPublicProduct(raw);
  const minPrice = minVariantPricePoisha(raw);
  // Price-on-request (schema wave 2): the price, variant prices,
  // buy box, EMI note, sticky bar and JSON-LD offers are ALL hidden
  // below — the customer asks via the contact/inbox path instead.
  const priceOnRequest = product.priceOnRequest;
  // Age gate (ADV-29): when the product's category is configured
  // age-restricted (Settings catalog.age_restricted_categories),
  // the buy box below is wrapped in the AgeGate interstitial — a
  // self-declaration prompt, not verification; the binding gate is
  // the checkout refusal in the orders route.
  //
  // Per-product size chart replaces the old categorySlug ===
  // "fashion" hardcode: the button/section exist only when THIS
  // product has one.
  const sizeChart =
    product.sizeChart && product.sizeChart.headers.length > 0 && product.sizeChart.rows.length > 0
      ? product.sizeChart
      : null;
  // Speed wave batch 2: the tail reads — age restriction,
  // fashion-pack size chart, grocery weighted infos, related
  // products, subscription-box data — depend only on `product`
  // (already loaded above),
  // never on each other, so they run in ONE Promise.all instead of
  // four serial round trips. Gating is unchanged: the age read is
  // skipped entirely for price-on-request products, the pack chart
  // is only fetched when the product has no chart of its own, and
  // the pack/grocery resolvers return null/[] at ~zero cost while
  // their module flag is off.
  const [ageRestriction, packSizeChart, weightedInfos, related, boxPdpData, podPdpNote, courseOutline] = await Promise.all([
    priceOnRequest ? null : getAgeRestrictionForCategorySlug(product.categorySlug),
    sizeChart ? null : resolvePdpPackSizeChart(product.categorySlug),
    getWeightedInfosForProduct(product.id),
    getRelatedProducts(product),
    // ADV-23 vertical 4: subscription-box data — null unless BOTH
    // subscription flags are ON and a variant of this product is a
    // listed box (~zero cost otherwise, the weightedInfos contract).
    priceOnRequest ? null : getBoxPdpData(product.variants.map((v) => v.id)),
    // ADV-23 vertical 5: print-on-demand note data — null unless
    // module.print_on_demand is ON and a variant of this product
    // is on the printable list (same ~zero-cost contract).
    priceOnRequest ? null : getPodPdpNote(product.variants.map((v) => v.id)),
    // ADV-23 vertical 6: course outline (module/lesson TITLES
    // only — the outline projection never carries lesson bodies)
    // — null unless module.courses is ON, a variant of this
    // product is a listed course variant, and content exists
    // (same ~zero-cost contract).
    priceOnRequest ? null : getCoursePdpData(product.id, product.variants.map((v) => v.id)),
  ]);
  // ADV-22 (fashion pack): when the product has NO chart of its own,
  // the pack chart for its category is the fallback (per-category
  // override, else the pack default). The product's own chart
  // always wins. The pack chart also carries the category fit note.
  const displaySizeChart = sizeChart ?? packSizeChart?.table ?? null;
  const maxPrice = maxVariantPricePoisha(raw);
  const hasPriceRange = maxPrice > minPrice;
  // Best available discount across active variants (display only).
  const compareCandidates = product.variants
    .filter((v) => v.isActive && v.compareAtPoisha !== null && v.compareAtPoisha > v.pricePoisha)
    .map((v) => ({ price: v.pricePoisha, compare: v.compareAtPoisha as number }));
  const bestDiscount =
    compareCandidates.length > 0
      ? compareCandidates.reduce((a, b) => (b.compare - b.price > a.compare - a.price ? b : a))
      : null;
  const discountPct = bestDiscount
    ? Math.round(((bestDiscount.compare - bestDiscount.price) / bestDiscount.compare) * 100)
    : 0;
  const inStock = product.variants.some((v) => v.isActive && v.stock > 0);
  // Product types (wave 15, doc 16 §P7): the public shape carries
  // `type` + the per-type blocks (toPublicProduct's spread preserves
  // them). SIMPLE — the default whenever the module flag is off —
  // changes nothing on this page.
  const typeFields = product as PublicProductWithTypeFields;
  const productType = productTypeOf(typeFields);
  const digitalFiles = typeFields.digitalFiles ?? [];
  const bundleComponents = typeFields.bundleComponents ?? [];
  // The service's fulfilment verdict for bundles; null = it said
  // nothing, so the bundle keeps the variant-stock behaviour.
  const bundleAvailable =
    productType === "BUNDLE" ? bundleAvailabilityState(typeFields) : null;
  const bundleUnavailable = bundleAvailable === false;
  // The service's numeric bundle count (wave-15 parent fix): a bundle
  // variant's own stock cache is not the sellable count, so the buy
  // box is fed the component-derived count (server re-checks anyway).
  const bundleCount =
    productType === "BUNDLE" && typeof typeFields.bundleAvailability === "number"
      ? typeFields.bundleAvailability
      : null;
  const displayInStock = bundleUnavailable ? false : bundleCount !== null ? bundleCount > 0 : inStock;
  // Honest social proof (doc 23 wave 60): while module.social_proof
  // is on, the buy box may print the selected variant's REAL stock
  // as a "মাত্র Nটি বাকি" line inside the 1..threshold band.
  // Flag off -> null -> BuyBoxActions renders no such line.
  const lowStockThreshold = socialProofEnabled() ? LOW_STOCK_THRESHOLD : null;
  const preorder = typeFields.preorder ?? null;
  const preorderExpectedLabel = preorder?.expectedDate
    ? (() => {
        const d = new Date(preorder.expectedDate as string);
        return Number.isNaN(d.getTime())
          ? null
          : d.toLocaleDateString("bn-BD", { day: "numeric", month: "long", year: "numeric" });
      })()
    : null;
  // Component sum for the "buy separately vs bundle" line — only
  // when EVERY component carries a public price; otherwise the line
  // is skipped rather than showing a partial (wrong) total.
  const bundleComponentsTotal =
    bundleComponents.length > 0 &&
    bundleComponents.every((c) => typeof c.unitPricePoisha === "number")
      ? bundleComponents.reduce((s, c) => s + (c.unitPricePoisha as number) * c.quantity, 0)
      : null;
  // Sale window (Wave 14-2): when the product carries a sale window
  // (saleStartsAt/saleEndsAt) that is NOT currently active, the
  // compare-at strike + discount badge are hidden — the price itself
  // never changes. No window (or an active one) keeps today's
  // behaviour; `saleActive` arrives derived on the public shape.
  const hasSaleWindow = Boolean(product.saleStartsAt || product.saleEndsAt);
  const showDiscount = bestDiscount !== null && (!hasSaleWindow || product.saleActive);
  // sizeChart / packSizeChart / displaySizeChart / weightedInfos
  // are resolved in the parallel tail-read block near the top of
  // this function (speed wave batch 2). ADV-22 (grocery pack):
  // weightedInfos carries the per-kg rate + pack weight from the
  // saved grocery config for this product's configured pack
  // variants — empty unless module.grocery is on.
  const faqItems = (product.faqItems ?? []).filter((f) => f.q.trim() !== "" && f.a.trim() !== "");
  // Specification table: union of variant attributes, key → distinct
  // values in first-seen order (active variants preferred).
  const specRows: Array<{ key: string; values: string[] }> = [];
  {
    const byKey = new Map<string, string[]>();
    const specVariants = product.variants.filter((v) => v.isActive);
    for (const v of specVariants.length > 0 ? specVariants : product.variants) {
      for (const [key, value] of Object.entries(v.attributes)) {
        const list = byKey.get(key) ?? [];
        if (!list.includes(value)) list.push(value);
        byKey.set(key, list);
      }
    }
    for (const [key, values] of byKey) specRows.push({ key, values });
  }
  const outOfStockVariants = product.variants
    .filter((v) => v.isActive && v.stock === 0)
    .map((v) => ({
      variantId: v.id,
      label: Object.values(v.attributes).join(" / ") || "স্ট্যান্ডার্ড",
    }));
  const recentlyViewedEntry: RecentlyViewedEntry = {
    productId: product.id,
    slug: product.slug,
    titleBn: product.title.bn,
    titleEn: product.title.en,
    pricePoisha: minPrice,
    imageUrl: product.images[0]?.url ?? null,
    viewedAt: new Date().toISOString(),
  };

  // JSON-LD outline — display-only conversion (fromPoisha) for schema.org;
  // internal money stays integer poisha everywhere else.
  const galleryUrls = product.images.map((img) => img.url);
  const firstVariant = product.variants[0];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title.bn,
    description: product.description.bn,
    ...(galleryUrls.length > 0 ? { image: galleryUrls } : {}),
    ...(firstVariant ? { sku: firstVariant.sku } : {}),
    ...(product.reviewCount > 0 && product.ratingAverage !== null
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: product.ratingAverage,
            reviewCount: product.reviewCount,
          },
        }
      : {}),
    brand: product.brandName ? { "@type": "Brand", name: product.brandName } : undefined,
    // No offers block for price-on-request products: publishing a
    // price in structured data would defeat the point of hiding it.
    ...(priceOnRequest
      ? {}
      : {
          offers: {
            "@type": "Offer",
            priceCurrency: "BDT",
            price: fromPoisha(minPrice).toFixed(2),
            availability: product.variants.some((v) => v.stock > 0)
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock",
          },
        }),
  };

  // PdpComposition slot (S3b): the arrangement (gallery + buy-box
  // grid + section order) is the active package's composition,
  // resolved server-side exactly like the home page resolves
  // HomeSections — per-slot Aurora fallback in the registry, Aurora
  // again as the ThemeBoundary fallback at runtime. Every value the
  // composition renders was computed above, unchanged; theme
  // resolution reads only store-global catalog data (no request
  // APIs), so this page's ISR behaviour is unchanged.
  const { themeView } = await resolveStorefrontThemeFromStore();
  const PdpComposition = getThemeSlots(themeView.packageId).PdpComposition;
  const AuroraPdpComposition = AURORA_SLOTS.PdpComposition;
  const compositionProps: PdpCompositionProps = {
    product,
    productType,
    digitalFiles,
    bundleComponents,
    preorder,
    preorderExpectedLabel,
    priceOnRequest,
    minPrice,
    maxPrice,
    hasPriceRange,
    showDiscount,
    bestDiscount,
    discountPct,
    displayInStock,
    bundleUnavailable,
    bundleCount,
    bundleComponentsTotal,
    lowStockThreshold,
    spinEnabled,
    ageMinAge: ageRestriction?.minAge ?? null,
    weightedInfos,
    boxPdpData,
    podPdpNote,
    courseOutline,
    displaySizeChart,
    packSizeChart,
    specRows,
    faqItems,
    outOfStockVariants,
    related,
    recentlyViewedEntry,
    jsonLd,
  };

  return (
    <ThemeBoundary
      slotName="PdpComposition"
      packageId={themeView.packageId}
      fallback={<AuroraPdpComposition {...compositionProps} />}
    >
      <PdpComposition {...compositionProps} />
    </ThemeBoundary>
  );
}

/**
 * ISR (wave 46): pre-render the current catalogue at build time so PDPs
 * serve from the edge cache; products created later generate on first
 * visit (dynamicParams default) and are then cached with the same 60s
 * revalidation. The page itself still enforces the live-publication
 * gate, so a scheduled/inactive slug pre-rendered here resolves to the
 * same 404 a dynamic render would produce. Capped at 500 slugs so a
 * very large catalogue cannot stall the deploy build — the remainder
 * are covered by on-demand generation. A DB failure returns [] (the
 * build must never fail because params could not be loaded).
 */
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  try {
    const { prisma } = await import("@advance-ecommerce/db");
    const rows = await prisma.product.findMany({
      where: { status: "ACTIVE" },
      select: { slug: true },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
    return rows.map((r) => ({ slug: r.slug }));
  } catch {
    return [];
  }
}
