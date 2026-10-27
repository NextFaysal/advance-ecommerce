// Shared storefront product card — mobile-first, Bangla long text safe.
// Uses min-w-0 + break-words so long Bangla titles never break the grid.
// Design refresh (Direction A — Premium): 4:5 imagery, discount badge,
// wishlist heart overlay, star rating, strike-through compare price,
// soft elevation with hover lift.
// Wave 17 (A+ Aurora polish): token elevation (shadow-card → lift),
// stacked badge column (no offset hacks), glass wishlist chip at a full
// 44px touch target, slower image zoom, equal-height cards (h-full).
"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { formatBdt } from "@advance-ecommerce/validators";
import { toggleWishlistId } from "./wishlist";
import { useDigitText } from "@/components/ui/numerals";
import type { PublicProduct } from "./types";
import { minVariantPricePoisha } from "./types";
import {
  PRODUCT_TYPE_BADGE_LABEL,
  productTypeOf,
  type PublicProductWithTypeFields,
} from "./product-type-contract";
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

// Public card — typed on PublicProduct (no costPoisha anywhere in the
// shape), so a full admin Product cannot be passed here by accident:
// cost prices can never ride this component's serialized props.
export function ProductCard({ product }: { product: PublicProduct }) {
  const digits = useDigitText();
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
  // Price-on-request (schema wave 2): the card shows the label
  // instead of any price and no add-to-cart (quick view stays —
  // it gates its own price/ATC the same way).
  const priceOnRequest = product.priceOnRequest;
  const rating = product.ratingAverage ?? 0;
  const fullStars = Math.round(rating);
  const imageUrl = product.images[0]?.url ?? defaultVariant?.imageUrl ?? null;
  // Product-type badge (wave 15): non-SIMPLE types only; SIMPLE —
  // including every product while the module flag is off — renders
  // exactly as before.
  const cardType = productTypeOf(product as PublicProductWithTypeFields);
  const typeBadgeLabel = cardType !== "SIMPLE" ? PRODUCT_TYPE_BADGE_LABEL[cardType] : null;
  const typeBadgeCls =
    cardType === "DIGITAL" ? "bg-violet-600" : cardType === "BUNDLE" ? "bg-amber-600" : "bg-sky-600";

  return (
    <article className="group relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card transition duration-300 hover:-translate-y-1 hover:shadow-lift">
      {/* Wishlist — overlay, outside the product link so it stays clickable */}
      <button
        type="button"
        aria-label={wishlisted ? "উইশলিস্ট থেকে সরান" : "উইশলিস্টে যোগ করুন"}
        aria-pressed={wishlisted}
        onClick={() => {
          toggleWishlistId(product.id);
          setWishlisted((w) => !w);
        }}
        className="absolute right-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-surface/90 text-text-muted shadow-card backdrop-blur transition duration-200 hover:scale-105 hover:text-rose-600 active:scale-95"
      >
        <HeartIcon filled={wishlisted} />
      </button>

      <Link href={`/product/${product.slug}`} className="block min-w-0">
        {/* Image — 4:5. Real product photo when the catalog has one;
            otherwise a designed tinted placeholder (never a broken img). */}
        <div className="relative aspect-[4/5] overflow-hidden bg-surface-2">
          {imageUrl ? (
            // next/image with fill inside the aspect-[4/5] box: the
            // optimizer serves AVIF/WebP at the sizes the grid actually
            // renders instead of the full-resolution original.
            <Image
              src={imageUrl}
              alt={product.images[0]?.altBn ?? product.title.bn}
              fill
              sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
              loading="lazy"
              className={`object-cover transition duration-500 ease-out group-hover:scale-[1.06] ${inStock ? "" : "opacity-60 grayscale"}`}
            />
          ) : (
            <div
              className={`flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary via-surface-2 to-accent/10 text-primary/40 ${inStock ? "" : "opacity-60 grayscale"}`}
            >
              <BagIcon />
            </div>
          )}
          {/* Badge stack — type + discount in one column so they can
              never overlap, however many badges a product carries. */}
          {typeBadgeLabel || discountPct > 0 ? (
            <div className="absolute left-2.5 top-2.5 z-[5] flex flex-col items-start gap-1.5">
              {typeBadgeLabel ? (
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold text-white shadow-sm ${typeBadgeCls}`}
                >
                  {typeBadgeLabel}
                </span>
              ) : null}
              {discountPct > 0 && !priceOnRequest ? (
                <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white shadow-sm">
                  {digits(`-${discountPct}%`)}
                </span>
              ) : null}
            </div>
          ) : null}
          {!inStock ? (
            <span className="absolute bottom-2.5 left-2.5 rounded-full bg-text-main/85 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
              স্টক শেষ
            </span>
          ) : null}
        </div>

        <div className="px-4 pt-3.5">
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
            <span className="ml-1 text-xs tabular-nums text-text-subtle">
              {product.ratingAverage ?? "—"} ({product.reviewCount})
            </span>
          </p>
          {priceOnRequest ? (
            <p className="mt-2 text-base font-extrabold text-primary">
              দামের জন্য যোগাযোগ করুন
            </p>
          ) : (
          <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
            <span className="text-base font-extrabold tabular-nums text-primary">{digits(formatBdt(price))}</span>
            {compareAt !== null && compareAt > price ? (
              <span className="text-[13px] tabular-nums text-text-subtle line-through">{digits(formatBdt(compareAt))}</span>
            ) : null}
          </p>
          )}
          <p className={`mt-1 text-xs font-medium ${inStock ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
            {inStock ? "স্টকে আছে" : "স্টক শেষ"}
          </p>
        </div>
      </Link>

      <div className="mt-auto flex gap-2 px-4 pb-4 pt-3">
        {defaultVariant && !priceOnRequest ? (
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
          onClick={() => setShowQuickView(true)}
          aria-haspopup="dialog"
          className="min-h-[44px] rounded-xl border border-border px-3 py-2 text-sm font-medium text-text-muted transition duration-200 hover:border-input hover:bg-surface-2 hover:text-text-main active:scale-[0.98]"
        >
          ঝটপট দেখুন
        </button>
      </div>

      {/* Quick view (Design v3) — real modal with variant picker +
          add-to-cart; replaces the old inline expand panel. */}
      <QuickView product={product} open={showQuickView} onClose={() => setShowQuickView(false)} />
    </article>
  );
}
