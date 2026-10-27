"use client";

// QuickView — Design v3 (§4): real modal quick-view for a product card.
// Opened by ProductCard's "ঝটপট দেখুন" button. Shows the card's own
// PUBLIC product shape (no extra fetch, no cost data): image, brand,
// rating, a variant picker, per-variant price/stock, and the SAME
// AddToCartButton contract the card itself uses — only the variant is
// the shopper's selected one instead of the card default.
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBdt } from "@advance-ecommerce/validators";
import { Modal } from "@/components/ui/modal";
import { useDigitText } from "@/components/ui/numerals";
import { AddToCartButton } from "@/cart/components/AddToCartButton";
import type { PublicProduct, PublicVariant } from "./types";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { CATALOG_STRINGS } from "./strings";

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="14"
      height="14"
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

function BagIcon() {
  return (
    <svg
      width="52"
      height="52"
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

function variantLabel(v: PublicVariant, standardLabel: string): string {
  return Object.values(v.attributes).join(" / ") || standardLabel;
}

/** Same default the card picks: first active in-stock, else first active. */
function defaultVariantOf(product: PublicProduct): PublicVariant | null {
  return (
    product.variants.find((v) => v.isActive && v.stock > 0) ??
    product.variants.find((v) => v.isActive) ??
    null
  );
}

export function QuickView({
  product,
  open,
  onClose,
}: {
  product: PublicProduct;
  open: boolean;
  onClose: () => void;
}) {
  const { locale, t } = useLocale();
  const s = pick(locale, CATALOG_STRINGS);
  const digits = useDigitText();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Reset the picker to the card default every time the modal opens
  // (or a different product is passed in).
  useEffect(() => {
    if (open) setSelectedId(defaultVariantOf(product)?.id ?? null);
  }, [open, product]);

  if (!open) return null;

  const selected =
    product.variants.find((v) => v.id === selectedId) ?? defaultVariantOf(product);
  const selectable = product.variants.filter((v) => v.isActive);
  const price = selected?.pricePoisha ?? 0;
  const compareAt = selected?.compareAtPoisha ?? null;
  const discountPct =
    compareAt !== null && compareAt > price && price > 0
      ? Math.round(((compareAt - price) / compareAt) * 100)
      : 0;
  const inStock = selected !== null && selected.stock > 0;
  const imageUrl = selected?.imageUrl ?? product.images[0]?.url ?? null;
  const rating = product.ratingAverage ?? 0;
  const fullStars = Math.round(rating);

  return (
    <Modal open={open} onClose={onClose} title={s.quickView}>
      <div className="max-h-[70vh] overflow-y-auto">
        {/* Image */}
        <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-surface-2">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={
                (locale === "bn" ? product.images[0]?.altBn : product.images[0]?.altEn) ??
                product.title[locale]
              }
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-50 via-surface-2 to-violet-500/10 text-brand-300">
              <BagIcon />
            </div>
          )}
          {discountPct > 0 ? (
            <span className="absolute left-3 top-3 rounded-full bg-rose-600 px-2.5 py-1 text-xs font-bold text-white shadow-sm">
              -{discountPct}%
            </span>
          ) : null}
        </div>

        {/* Brand + title + rating */}
        {product.brandName ? (
          <p className="mt-4 text-xs font-semibold tracking-wide text-text-subtle">{product.brandName}</p>
        ) : null}
        <h3 className="mt-1 break-words text-lg font-bold leading-snug text-text-main [overflow-wrap:anywhere]">
          {product.title[locale]}
        </h3>
        <p
          className="mt-1.5 flex items-center gap-1"
          aria-label={interpolate(s.ratingLabel, { rating })}
        >
          {[1, 2, 3, 4, 5].map((i) => (
            <StarIcon key={i} filled={i <= fullStars} />
          ))}
          <span className="ml-1 text-xs text-text-subtle">
            {product.ratingAverage ?? "—"} ({interpolate(s.reviewsCount, { count: product.reviewCount })})
          </span>
        </p>

        {/* Price — or the price-on-request label (schema wave 2) */}
        {product.priceOnRequest ? (
          <p className="mt-3 text-2xl font-extrabold text-brand-700">{s.priceOnRequest}</p>
        ) : (
        <p className="mt-3 flex flex-wrap items-baseline gap-x-2.5">
          <span className="text-2xl font-extrabold tabular-nums text-brand-700">{digits(formatBdt(price))}</span>
          {compareAt !== null && compareAt > price ? (
            <span className="text-sm tabular-nums text-text-subtle line-through">{digits(formatBdt(compareAt))}</span>
          ) : null}
        </p>
        )}
        <p className={`mt-1 text-sm font-medium ${inStock ? "text-emerald-600" : "text-rose-600"}`}>
          {inStock ? t.inStock : t.outOfStock}
        </p>

        {/* Variant picker */}
        {selectable.length > 1 ? (
          <div className="mt-4">
            <p className="text-sm font-bold text-text-main">{s.variantPickerTitle}</p>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={s.variantGroupLabel}>
              {selectable.map((v) => {
                const active = selected?.id === v.id;
                const soldOut = v.stock <= 0;
                return (
                  <button
                    key={v.id}
                    type="button"
                    disabled={soldOut}
                    aria-pressed={active}
                    onClick={() => setSelectedId(v.id)}
                    className={`min-h-[44px] rounded-xl border px-3.5 text-sm transition ${
                      soldOut
                        ? "cursor-not-allowed border-border bg-surface-2 text-text-subtle"
                        : active
                          ? "border-brand-600 bg-brand-50 font-semibold text-brand-700"
                          : "border-border bg-surface text-text-main hover:border-brand-300"
                    }`}
                  >
                    {variantLabel(v, s.standardVariant)}
                    {product.priceOnRequest ? null : (
                      <> — <span className="tabular-nums">{digits(formatBdt(v.pricePoisha))}</span></>
                    )}
                    {soldOut ? s.soldOutParenthetical : ""}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Short description */}
        {product.description.bn ? (
          <p className="mt-4 line-clamp-3 break-words text-sm leading-6 text-text-muted [overflow-wrap:anywhere]">
            {product.description.bn}
          </p>
        ) : null}

        {/* Actions — same AddToCartButton contract as the card;
            no add-to-cart for price-on-request products. */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {selected && !product.priceOnRequest ? (
            <AddToCartButton
              key={selected.id}
              className="flex-1"
              productId={product.id}
              productTitleBn={product.title.bn}
              variant={{
                variantId: selected.id,
                sku: selected.sku,
                unitPricePoisha: selected.pricePoisha,
                compareAtPoisha: selected.compareAtPoisha,
                stock: selected.stock,
                imageUrl: selected.imageUrl ?? product.images[0]?.url ?? null,
              }}
            />
          ) : null}
          <Link
            href={`/product/${product.slug}`}
            onClick={onClose}
            className="inline-flex min-h-[44px] items-center rounded-xl border border-border px-4 text-sm font-semibold text-text-main transition hover:bg-surface-2"
          >
            {s.viewDetails}
          </Link>
        </div>
      </div>
    </Modal>
  );
}
