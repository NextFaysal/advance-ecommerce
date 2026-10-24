// Shared storefront product card — mobile-first, Bangla long text safe.
// Uses min-w-0 + break-words so long Bangla titles never break the grid.
"use client";

import Link from "next/link";
import { useState } from "react";
import { formatBdt } from "@advance-ecommerce/validators";
import { toggleWishlistId } from "./wishlist";
import type { PublicProduct } from "./types";
import { minVariantPricePoisha } from "./types";
import { AddToCartButton } from "@/cart/components/AddToCartButton";

// Public card — typed on PublicProduct (no costPoisha anywhere in the
// shape), so a full admin Product cannot be passed here by accident:
// cost prices can never ride this component's serialized props.
export function ProductCard({ product }: { product: PublicProduct }) {
  const [wishlisted, setWishlisted] = useState(false);
  const [showQuickView, setShowQuickView] = useState(false);
  const price = minVariantPricePoisha(product);
  const inStock = product.variants.some((v) => v.isActive && v.stock > 0);
  // Default variant for the card's add-to-cart: first active in-stock
  // variant, falling back to the first active variant (button disables
  // itself when that variant is out of stock).
  const defaultVariant =
    product.variants.find((v) => v.isActive && v.stock > 0) ??
    product.variants.find((v) => v.isActive) ??
    null;

  return (
    <article className="min-w-0 rounded-xl border border-[#E6E8F2] bg-white p-3">
      <Link href={`/product/${product.slug}`} className="block min-w-0">
        {/* Image: real pipeline (Step 9) serves WebP/AVIF via next/image + R2/CDN.
            Skeleton uses a div placeholder so no broken external image is shipped. */}
        <div className="flex h-40 items-center justify-center rounded-lg bg-[#F8F9FD] text-sm text-slate-500">
          ছবি আসবে (WebP/AVIF)
        </div>
        <h3 className="mt-3 break-words text-sm font-semibold leading-6 text-[#1F2037] [overflow-wrap:anywhere]">
          {product.title.bn}
        </h3>
        <p className="mt-1 text-sm font-bold text-[#4F46E5]">{formatBdt(price)}</p>
        <p className="mt-1 text-xs text-slate-500">
          {inStock ? "স্টকে আছে" : "স্টক শেষ"} • ★ {product.ratingAverage ?? "—"} ({product.reviewCount})
        </p>
      </Link>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => setShowQuickView(true)}
          className="rounded-lg bg-[#4F46E5] px-3 py-2 text-sm font-semibold text-white"
        >
          Quick View
        </button>
        {defaultVariant ? (
          <AddToCartButton
            className="flex-1"
            productId={product.id}
            productTitleBn={product.title.bn}
            variant={{
              variantId: defaultVariant.id,
              sku: defaultVariant.sku,
              unitPricePoisha: defaultVariant.pricePoisha,
              compareAtPoisha: defaultVariant.compareAtPoisha,
              stock: defaultVariant.stock,
              imageUrl: defaultVariant.imageUrl ?? product.images[0]?.url ?? null,
            }}
          />
        ) : null}
        <button
          type="button"
          aria-label="Wishlist"
          onClick={() => {
            toggleWishlistId(product.id);
            setWishlisted((w) => !w);
          }}
          className="rounded-lg border px-3 py-2 text-sm"
        >
          {wishlisted ? "♥" : "♡"}
        </button>
      </div>
      {showQuickView && (
        <div role="dialog" aria-label="Quick view" className="mt-3 rounded-lg bg-[#F8F9FD] p-3">
          <p className="break-words text-sm leading-6 [overflow-wrap:anywhere]">
            {product.description.bn}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            ভেরিয়েন্ট: {product.variants.map((v) => Object.values(v.attributes).join(" / ") || "স্ট্যান্ডার্ড").join(", ")}
          </p>
          <Link href={`/product/${product.slug}`} className="mt-2 inline-block text-sm font-semibold text-[#4F46E5]">
            বিস্তারিত দেখুন →
          </Link>
          <button type="button" onClick={() => setShowQuickView(false)} className="ml-3 text-sm text-slate-500">
            বন্ধ করুন
          </button>
        </div>
      )}
    </article>
  );
}
