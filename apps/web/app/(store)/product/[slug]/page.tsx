import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatBdt, fromPoisha } from "@advance-ecommerce/validators";
import { tryCatalogRepository } from "@/catalog/server-read";
import { minVariantPricePoisha, toPublicProduct } from "@/catalog/types";
import { RecordRecentlyViewed } from "@/storefront-ux/components/RecordRecentlyViewed";
import { RecentlyViewedRail } from "@/storefront-ux/components/RecentlyViewedRail";
import { StickyBuyBar } from "@/storefront-ux/components/StickyBuyBar";
import { CompareToggleButton, CompareTray } from "@/storefront-ux/components/CompareTray";
import { SizeGuideButton } from "@/storefront-ux/components/SizeGuideModal";
import { BackInStockForm } from "@/storefront-ux/components/BackInStockForm";
import { BuyBoxActions } from "@/cart/components/BuyBoxActions";
import type { RecentlyViewedEntry } from "@/storefront-ux/types";

// Data: real catalog DB via the repository PUBLIC read path
// (ACTIVE-only) — a DRAFT/ARCHIVED slug 404s exactly like a missing one.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const repo = await tryCatalogRepository();
  const product = repo ? await repo.getPublicProductBySlug(params.slug) : null;
  if (!product) return { title: "পণ্য পাওয়া যায়নি" };
  return {
    title: product.seoTitle?.bn ?? product.title.bn,
    description: product.seoDescription?.bn ?? product.description.bn,
    openGraph: {
      title: product.seoTitle?.bn ?? product.title.bn,
      description: product.seoDescription?.bn ?? product.description.bn,
      type: "website",
    },
  };
}

export default async function ProductPage({ params }: { params: { slug: string } }) {
  const repo = await tryCatalogRepository();
  const raw = repo ? await repo.getPublicProductBySlug(params.slug) : null;
  if (!raw) notFound();
  // Public view: costPoisha stripped — never render cost to customers.
  const product = toPublicProduct(raw);
  const minPrice = minVariantPricePoisha(raw);
  const inStock = product.variants.some((v) => v.isActive && v.stock > 0);
  const hasSizeGuide = product.categorySlug === "fashion";
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
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title.bn,
    description: product.description.bn,
    brand: product.brandName ? { "@type": "Brand", name: product.brandName } : undefined,
    offers: {
      "@type": "Offer",
      priceCurrency: "BDT",
      price: fromPoisha(minPrice).toFixed(2),
      availability: product.variants.some((v) => v.stock > 0)
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
    },
  };

  return (
    <main className="mx-auto min-w-0 max-w-7xl px-4 py-6">
      <RecordRecentlyViewed entry={recentlyViewedEntry} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Link href="/shop" className="text-sm text-[#4F46E5]">← সব পণ্য</Link>

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <div>
          <div className="flex h-72 items-center justify-center rounded-xl bg-[#F8F9FD] text-slate-500">
            পণ্যের ছবি (WebP/AVIF — Step 9)
          </div>
          <p className="mt-2 text-xs text-slate-500">গ্যালারি: drag-reorder + thumbnail + zoom — Step 9 media pipeline-এ।</p>
        </div>

        <div className="min-w-0">
          <h1 className="break-words text-2xl font-bold leading-8 [overflow-wrap:anywhere]">{product.title.bn}</h1>
          <p className="mt-1 text-sm text-slate-500">{product.title.en}</p>
          <p className="mt-3 text-2xl font-bold text-[#4F46E5]">{formatBdt(minPrice)} থেকে</p>
          <p className="mt-1 text-sm text-slate-500">
            ★ {product.ratingAverage ?? "—"} ({product.reviewCount} রিভিউ) • {product.brandName ?? "No brand"}
          </p>

          <h2 className="mt-6 font-semibold">ভেরিয়েন্ট</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {product.variants.map((v) => (
              <span key={v.id} className="rounded-full border px-3 py-1 text-sm">
                {Object.values(v.attributes).join(" / ") || "স্ট্যান্ডার্ড"} — {formatBdt(v.pricePoisha)}
                {v.stock > 0 ? ` (স্টক: ${v.stock})` : " (স্টক শেষ)"}
              </span>
            ))}
          </div>

          <p className="mt-6 break-words leading-7 [overflow-wrap:anywhere]">{product.description.bn}</p>

          <div id="buy-box" className="mt-6 flex items-start gap-2">
            {/* Add-to-cart + buy-now (Agent 35): client variant picker +
                quantity + guest-cart write via src/cart contracts. */}
            <BuyBoxActions
              productId={product.id}
              productTitleBn={product.title.bn}
              imageUrl={product.images[0]?.url ?? null}
              variants={product.variants}
            />
            <button type="button" className="rounded-lg border px-4 py-3 text-sm">♡ Wishlist</button>
          </div>

          <div className="mt-3 flex flex-wrap items-start gap-2">
            <CompareToggleButton productId={product.id} />
            {hasSizeGuide ? <SizeGuideButton /> : null}
          </div>

          <BackInStockForm productId={product.id} variants={outOfStockVariants} />
        </div>
      </div>

      <RecentlyViewedRail excludeProductId={product.id} />
      <StickyBuyBar titleBn={product.title.bn} pricePoisha={minPrice} inStock={inStock} buyBoxId="buy-box" />
      <CompareTray />
    </main>
  );
}
