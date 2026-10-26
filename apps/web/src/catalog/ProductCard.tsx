// Shared storefront product card — mobile-first, Bangla long text safe.
// Uses min-w-0 + break-words so long Bangla titles never break the grid.
// Modern creative redesign: dynamic 4:5 image ratio, glassmorphic wishlist badge,
// floating gradient discount pills, clean star ratings, and tactile buttons.
"use client";

import Link from "next/link";
import { useState } from "react";
import { formatBdt } from "@advance-ecommerce/validators";
import { toggleWishlistId } from "./wishlist";
import { useDigitText } from "@/components/ui/numerals";
import type { PublicProduct } from "./types";
import { minVariantPricePoisha } from "./types";
import { AddToCartButton } from "@/cart/components/AddToCartButton";
import { QuickView } from "./QuickView";

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

export function ProductCard({ product }: { product: PublicProduct }) {
  const digits = useDigitText();
  const [wishlisted, setWishlisted] = useState(false);
  const [showQuickView, setShowQuickView] = useState(false);
  const price = minVariantPricePoisha(product);
  const inStock = product.variants.some((v) => v.isActive && v.stock > 0);
  const defaultVariant =
    product.variants.find((v) => v.isActive && v.stock > 0) ??
    product.variants.find((v) => v.isActive) ??
    null;
  const compareAt = defaultVariant?.compareAtPoisha ?? null;
  const discountPct =
    compareAt !== null && compareAt > price && price > 0
      ? Math.round(((compareAt - price) / compareAt) * 100)
      : 0;
  const rating = product.ratingAverage ?? 0;
  const fullStars = Math.round(rating);
  const imageUrl = product.images[0]?.url ?? defaultVariant?.imageUrl ?? null;

  return (
    <article className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl">
      {/* Wishlist button */}
      <button
        type="button"
        aria-label={wishlisted ? "উইশলিস্ট থেকে সরান" : "উইশলিস্টে যোগ করুন"}
        aria-pressed={wishlisted}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleWishlistId(product.id);
          setWishlisted((w) => !w);
        }}
        className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 backdrop-blur-md text-text-muted shadow-md transition-all duration-200 hover:scale-110 hover:text-rose-600 hover:bg-white"
      >
        <HeartIcon filled={wishlisted} />
      </button>

      <Link href={`/product/${product.slug}`} className="block min-w-0">
        {/* Product Image */}
        <div className="relative aspect-[4/5] overflow-hidden bg-surface-2">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={product.images[0]?.altBn ?? product.title.bn}
              loading="lazy"
              className={`h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-108 ${
                inStock ? "" : "opacity-60 grayscale"
              }`}
            />
          ) : (
            <div
              className={`flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-50 via-surface-2 to-violet-500/10 text-brand-300 ${
                inStock ? "" : "opacity-60 grayscale"
              }`}
            >
              <BagIcon />
            </div>
          )}

          {/* Floating Discount Badge */}
          {discountPct > 0 ? (
            <span className="absolute left-3 top-3 inline-flex items-center rounded-full bg-gradient-to-r from-rose-500 to-pink-500 px-2.5 py-0.5 text-[11px] font-bold text-white shadow-md">
              {digits(`-${discountPct}%`)} ছাড়
            </span>
          ) : null}

          {/* Out of stock overlay badge */}
          {!inStock ? (
            <span className="absolute bottom-3 left-3 rounded-full bg-black/80 backdrop-blur-sm px-3 py-1 text-[11px] font-semibold text-white">
              স্টক শেষ
            </span>
          ) : null}
        </div>

        {/* Content Body */}
        <div className="px-4 pt-3.5">
          {product.brandName ? (
            <p className="truncate text-[11px] font-bold uppercase tracking-wider text-primary/80">
              {product.brandName}
            </p>
          ) : null}
          <h3 className="mt-1 line-clamp-2 min-h-[2.6em] break-words text-sm font-semibold leading-snug text-text-main transition-colors duration-200 group-hover:text-primary [overflow-wrap:anywhere]">
            {product.title.bn}
          </h3>

          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-1" aria-label={`রেটিং ${rating} / ৫`}>
              {[1, 2, 3, 4, 5].map((i) => (
                <StarIcon key={i} filled={i <= fullStars} />
              ))}
              <span className="ml-1 text-[11px] text-text-subtle font-medium">
                {product.ratingAverage ?? "—"} ({product.reviewCount})
              </span>
            </div>

            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${inStock ? "text-emerald-600" : "text-rose-600"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${inStock ? "bg-emerald-500" : "bg-rose-500"}`} />
              {inStock ? "স্টকে আছে" : "স্টক শেষ"}
            </span>
          </div>

          <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2">
            <span className="text-base font-extrabold tabular-nums text-primary">
              {digits(formatBdt(price))}
            </span>
            {compareAt !== null && compareAt > price ? (
              <span className="text-xs tabular-nums text-text-subtle line-through opacity-70">
                {digits(formatBdt(compareAt))}
              </span>
            ) : null}
          </div>
        </div>
      </Link>

      {/* Action Footer */}
      <div className="mt-auto flex items-center gap-2 px-4 pb-4 pt-3.5">
        {defaultVariant ? (
          <AddToCartButton
            className="flex-1 rounded-xl shadow-sm hover:shadow transition-all"
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
          onClick={() => setShowQuickView(true)}
          aria-haspopup="dialog"
          className="min-h-[42px] rounded-xl border border-border/80 px-3 py-2 text-xs font-semibold text-text-muted transition-all duration-200 hover:border-primary/50 hover:bg-primary/5 hover:text-primary active:scale-95"
        >
          ঝটপট দেখুন
        </button>
      </div>

      <QuickView product={product} open={showQuickView} onClose={() => setShowQuickView(false)} />
    </article>
  );
}
