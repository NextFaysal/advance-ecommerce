// Shared storefront product card — mobile-first, Bangla long text safe.
// Uses min-w-0 + break-words so long Bangla titles never break the grid.
// Design refresh (Direction A — Premium): 4:5 imagery, discount badge,
// wishlist heart overlay, star rating, strike-through compare price,
// soft elevation with hover lift.
"use client";

import Link from "next/link";
import { useState } from "react";
import { formatBdt } from "@advance-ecommerce/validators";
import { toggleWishlistId } from "./wishlist";
import type { PublicProduct } from "./types";
import { minVariantPricePoisha } from "./types";
import { AddToCartButton } from "@/cart/components/AddToCartButton";

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill={filled ? "#F59E0B" : "none"}
      stroke="#F59E0B"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3.6l2.5 5.2 5.7.7-4.2 3.9 1.1 5.6L12 16.3l-5.1 2.7 1.1-5.6-4.2-3.9 5.7-.7L12 3.6z" />
    </svg>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill={filled ? "#E11D48" : "none"}
      stroke={filled ? "#E11D48" : "currentColor"}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 1 1 12 6.1a5 5 0 1 1 7.5 6.5Z" />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg
      width="44"
      height="44"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 8h14l-1.2 12.1a1.5 1.5 0 0 1-1.5 1.4H7.7a1.5 1.5 0 0 1-1.5-1.4L5 8Z" />
      <path d="M8.5 10.5V6.8a3.5 3.5 0 0 1 7 0v3.7" />
    </svg>
  );
}

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
  // Discount is computed off the default variant's compare-at price —
  // the same variant the price + add-to-cart refer to.
  const compareAt = defaultVariant?.compareAtPoisha ?? null;
  const discountPct =
    compareAt !== null && compareAt > price && price > 0
      ? Math.round(((compareAt - price) / compareAt) * 100)
      : 0;
  const rating = product.ratingAverage ?? 0;
  const fullStars = Math.round(rating);
  const imageUrl = product.images[0]?.url ?? defaultVariant?.imageUrl ?? null;

  return (
    <article className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg">
      {/* Wishlist — overlay, outside the product link so it stays clickable */}
      <button
        type="button"
        aria-label={wishlisted ? "উইশলিস্ট থেকে সরান" : "উইশলিস্টে যোগ করুন"}
        aria-pressed={wishlisted}
        onClick={() => {
          toggleWishlistId(product.id);
          setWishlisted((w) => !w);
        }}
        className="absolute right-2.5 top-2.5 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-text-muted shadow-sm transition hover:text-rose-600"
      >
        <HeartIcon filled={wishlisted} />
      </button>

      <Link href={`/product/${product.slug}`} className="block min-w-0">
        {/* Image — 4:5. Real product photo when the catalog has one;
            otherwise a designed tinted placeholder (never a broken img). */}
        <div className="relative aspect-[4/5] overflow-hidden bg-surface-2">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={product.images[0]?.altBn ?? product.title.bn}
              loading="lazy"
              className={`h-full w-full object-cover transition duration-300 group-hover:scale-105 ${inStock ? "" : "opacity-60 grayscale"}`}
            />
          ) : (
            <div
              className={`flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-50 via-surface-2 to-violet-500/10 text-brand-300 ${inStock ? "" : "opacity-60 grayscale"}`}
            >
              <BagIcon />
            </div>
          )}
          {discountPct > 0 ? (
            <span className="absolute left-2.5 top-2.5 rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white shadow-sm">
              -{discountPct}%
            </span>
          ) : null}
          {!inStock ? (
            <span className="absolute bottom-2.5 left-2.5 rounded-full bg-text-main/85 px-2.5 py-1 text-[11px] font-semibold text-white">
              স্টক শেষ
            </span>
          ) : null}
        </div>

        <div className="px-3.5 pt-3">
          {product.brandName ? (
            <p className="truncate text-[11px] font-semibold tracking-wide text-text-subtle">
              {product.brandName}
            </p>
          ) : null}
          <h3 className="mt-0.5 line-clamp-2 min-h-[2.6em] break-words text-sm font-semibold leading-snug text-text-main [overflow-wrap:anywhere]">
            {product.title.bn}
          </h3>
          <p className="mt-1.5 flex items-center gap-1" aria-label={`রেটিং ${rating} / ৫`}>
            {[1, 2, 3, 4, 5].map((i) => (
              <StarIcon key={i} filled={i <= fullStars} />
            ))}
            <span className="ml-1 text-xs text-text-subtle">
              {product.ratingAverage ?? "—"} ({product.reviewCount})
            </span>
          </p>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
            <span className="text-[15px] font-bold tabular-nums text-brand-700">{formatBdt(price)}</span>
            {compareAt !== null && compareAt > price ? (
              <span className="text-xs tabular-nums text-text-subtle line-through">{formatBdt(compareAt)}</span>
            ) : null}
          </p>
          <p className={`mt-1 text-xs font-medium ${inStock ? "text-emerald-600" : "text-rose-600"}`}>
            {inStock ? "স্টকে আছে" : "স্টক শেষ"}
          </p>
        </div>
      </Link>

      <div className="mt-auto flex gap-2 px-3.5 pb-3.5 pt-3">
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
          onClick={() => setShowQuickView((v) => !v)}
          aria-expanded={showQuickView}
          className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-text-muted transition hover:bg-surface-2 hover:text-text-main"
        >
          ঝটপট দেখুন
        </button>
      </div>

      {showQuickView && (
        <div role="dialog" aria-label="ঝটপট দেখা" className="mx-3.5 mb-3.5 rounded-xl bg-surface-2 p-3">
          <p className="line-clamp-4 break-words text-sm leading-6 [overflow-wrap:anywhere]">
            {product.description.bn}
          </p>
          <p className="mt-2 text-xs text-text-muted">
            ভেরিয়েন্ট: {product.variants.map((v) => Object.values(v.attributes).join(" / ") || "স্ট্যান্ডার্ড").join(", ")}
          </p>
          <div className="mt-2 flex items-center gap-3">
            <Link href={`/product/${product.slug}`} className="text-sm font-semibold text-brand-700 hover:underline">
              বিস্তারিত দেখুন →
            </Link>
            <button type="button" onClick={() => setShowQuickView(false)} className="text-sm text-text-muted hover:text-text-main">
              বন্ধ করুন
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
