"use client";

/**
 * Circuit ProductCard (doc 27 T-D) — ThemeProductCardProps { product }.
 *
 * The tech-store card: SPACIOUS white rounded card, a big image,
 * a dark two-line title, a bold RED price (the package's
 * destructive token — prices are red by design in this package)
 * with a grey strikethrough compare-at, and a full-width solid
 * Add to Cart. No star-rating row: this package's cards never
 * print ratings.
 *
 * SIGNATURE badge — the purple pill "সাশ্রয় ৳X (−Y%)": computed
 * ONLY from the default variant's real compareAtPoisha against the
 * minimum variant price (the exact derivation the card family
 * uses): the saved AMOUNT and the percentage together. When no
 * real compare-at discount exists, no pill renders — savings are
 * never invented.
 *
 * Other badge honesty, same discipline as the family:
 * - LEFT flag badge: the product-TYPE label
 *   (PRODUCT_TYPE_BADGE_LABEL) when the product is non-SIMPLE —
 *   a real signal PublicProduct carries. There is no bestseller /
 *   new-arrival / flash flag in the data, so none is printed.
 * - Out of stock: a "স্টক শেষ" chip + disabled button.
 * - Price-on-request products show the contact label and no
 *   add-to-cart (same gate as the other packages' cards).
 *
 * Cart wiring is NOT re-implemented: the button calls the same
 * addItemToGuestCart() the platform's AddToCartButton uses (same
 * guest-cart contract, same CART_UPDATED_EVENT), then dispatches
 * the drawer-open event only when units were actually added.
 *
 * `CircuitProductCardHorizontal` is the featured-rail variant
 * (image left ~40%, details right, same price/badge/add-to-cart
 * anatomy). It is composition-internal to this package (the home
 * sections import it directly) and deliberately NOT part of the
 * ProductCard slot contract.
 */
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { formatBdt } from "@advance-ecommerce/validators";
import { useDigitText } from "@/components/ui/numerals";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { CIRCUIT_STRINGS } from "./strings";
import { Icon } from "@/components/ui/icon";
import type { PublicProduct } from "@/catalog/types";
import { minVariantPricePoisha } from "@/catalog/types";
import {
  PRODUCT_TYPE_BADGE_LABEL,
  productTypeOf,
  type PublicProductWithTypeFields,
} from "@/catalog/product-type-contract";
import { addItemToGuestCart } from "@/cart/components/AddToCartButton";
import { openCartDrawer } from "../cart-drawer-events";
import { CIRCUIT_COLORS } from "./tokens";
import type { ThemeProductCardProps } from "../slots";

/** The display values both card variants share. */
function useCardData(product: PublicProduct) {
  const price = minVariantPricePoisha(product);
  const inStock = product.variants.some((v) => v.isActive && v.stock > 0);
  const defaultVariant =
    product.variants.find((v) => v.isActive && v.stock > 0) ??
    product.variants.find((v) => v.isActive) ??
    null;
  const compareAt = defaultVariant?.compareAtPoisha ?? null;
  const savePoisha =
    compareAt !== null && compareAt > price && price > 0 ? compareAt - price : 0;
  const discountPct =
    savePoisha > 0 && compareAt !== null
      ? Math.round((savePoisha / compareAt) * 100)
      : 0;
  const imageUrl = product.images[0]?.url ?? defaultVariant?.imageUrl ?? null;
  const cardType = productTypeOf(product as PublicProductWithTypeFields);
  const typeBadgeLabel =
    cardType !== "SIMPLE" ? PRODUCT_TYPE_BADGE_LABEL[cardType] : null;
  return {
    price,
    inStock,
    defaultVariant,
    compareAt,
    savePoisha,
    discountPct,
    imageUrl,
    typeBadgeLabel,
    priceOnRequest: product.priceOnRequest,
  };
}

type CardData = ReturnType<typeof useCardData>;

/** The signature purple savings pill — real compare-at data only. */
function SavingPill({
  savePoisha,
  pct,
  digits,
}: {
  savePoisha: number;
  pct: number;
  digits: (t: string) => string;
}) {
  const { locale } = useLocale();
  const s = pick(locale, CIRCUIT_STRINGS);
  return (
    <span
      className="rounded-full px-2.5 py-1 text-[11px] font-bold text-white shadow-sm"
      style={{ backgroundColor: CIRCUIT_COLORS.savePurple }}
    >
      {digits(interpolate(s.saveLine, { amount: formatBdt(savePoisha), pct }))}
    </span>
  );
}

function TypeFlag({ label }: { label: string }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white shadow-sm"
      style={{ backgroundColor: CIRCUIT_COLORS.navy }}
    >
      {label}
    </span>
  );
}

function DevicePlaceholder() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
      <path d="M9.5 20.5h5M12 16.5v4" />
    </svg>
  );
}

/**
 * The solid add-to-cart button shared by both variants. Calls the
 * platform's addItemToGuestCart (AddToCartButton's own helper) and
 * opens the drawer on a successful add.
 */
function CircuitAddButton({
  product,
  data,
  className = "",
}: {
  product: PublicProduct;
  data: CardData;
  className?: string;
}) {
  const { locale } = useLocale();
  const s = pick(locale, CIRCUIT_STRINGS);
  const [justAdded, setJustAdded] = useState(false);
  const { defaultVariant, inStock } = data;
  if (!defaultVariant || data.priceOnRequest) return null;

  function handleAdd() {
    if (!defaultVariant) return;
    const result = addItemToGuestCart({
      productId: product.id,
      productTitleBn: product.title.bn,
      variant: {
        variantId: defaultVariant.id,
        sku: defaultVariant.sku,
        unitPricePoisha: defaultVariant.pricePoisha,
        compareAtPoisha: defaultVariant.compareAtPoisha,
        stock: defaultVariant.stock,
        imageUrl: defaultVariant.imageUrl ?? product.images[0]?.url ?? null,
      },
      quantity: 1,
    });
    if (result.addedQuantity <= 0) return;
    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 2000);
    openCartDrawer();
  }

  return (
    <button
      type="button"
      onClick={handleAdd}
      disabled={!inStock}
      aria-live="polite"
      className={`flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-bold text-white transition active:scale-[0.98] ${
        inStock
          ? "bg-primary shadow-sm hover:opacity-90"
          : "cursor-not-allowed bg-muted !text-text-subtle shadow-none"
      } ${className}`}
    >
      <Icon name="cart" size={16} />
      {!inStock ? s.outOfStock : justAdded ? s.addedCheck : s.addToCart}
    </button>
  );
}

function PriceRow({ data, digits }: { data: CardData; digits: (t: string) => string }) {
  const { locale } = useLocale();
  const s = pick(locale, CIRCUIT_STRINGS);
  if (data.priceOnRequest) {
    return (
      <p className="text-[15px] font-extrabold text-destructive">{s.priceOnRequest}</p>
    );
  }
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-xl font-extrabold tabular-nums text-destructive">
        {digits(formatBdt(data.price))}
      </span>
      {data.compareAt !== null && data.compareAt > data.price ? (
        <span className="text-sm tabular-nums text-text-subtle line-through">
          {digits(formatBdt(data.compareAt))}
        </span>
      ) : null}
    </p>
  );
}

/** Standard (vertical) card — the ProductCard slot implementation. */
export function CircuitProductCard({ product }: ThemeProductCardProps) {
  const { locale } = useLocale();
  const s = pick(locale, CIRCUIT_STRINGS);
  const digits = useDigitText();
  const data = useCardData(product);

  return (
    <article className="group relative flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-card transition duration-200 hover:shadow-lift">
      <Link href={`/product/${product.slug}`} className="block min-w-0">
        <div className="relative aspect-[4/3] overflow-hidden bg-surface-2">
          {data.imageUrl ? (
            <Image
              src={data.imageUrl}
              alt={product.images[0]?.altBn ?? product.title.bn}
              fill
              sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
              loading="lazy"
              className={`object-cover transition duration-300 group-hover:scale-[1.04] ${data.inStock ? "" : "opacity-60 grayscale"}`}
            />
          ) : (
            <div
              className={`flex h-full w-full items-center justify-center bg-muted text-primary/40 ${data.inStock ? "" : "opacity-60 grayscale"}`}
            >
              <DevicePlaceholder />
            </div>
          )}
          {data.typeBadgeLabel ? (
            <span className="absolute left-2.5 top-2.5 z-[5]">
              <TypeFlag label={data.typeBadgeLabel} />
            </span>
          ) : null}
          {data.discountPct > 0 && !data.priceOnRequest ? (
            <span className="absolute right-2.5 top-2.5 z-[5]">
              <SavingPill savePoisha={data.savePoisha} pct={data.discountPct} digits={digits} />
            </span>
          ) : null}
          {!data.inStock ? (
            <span className="absolute bottom-2.5 left-2.5 rounded-full bg-text-main/85 px-2 py-0.5 text-[11px] font-semibold text-white">
              {s.outOfStock}
            </span>
          ) : null}
        </div>

        <div className="px-4 pt-3.5">
          {product.brandName ? (
            <p className="truncate text-[11px] font-semibold tracking-wide text-text-subtle">
              {product.brandName}
            </p>
          ) : null}
          <h3 className="line-clamp-2 min-h-[2.6em] break-words text-left text-[15px] font-semibold leading-snug text-text-main [overflow-wrap:anywhere]">
            {product.title.bn}
          </h3>
          <div className="mt-2">
            <PriceRow data={data} digits={digits} />
          </div>
        </div>
      </Link>

      <div className="mt-auto px-4 pb-4 pt-3">
        <CircuitAddButton product={product} data={data} />
      </div>
    </article>
  );
}

/**
 * Horizontal variant for the home featured rail: image left
 * (~40%), details right — same badges, price anatomy and
 * add-to-cart behaviour as the standard card.
 */
export function CircuitProductCardHorizontal({
  product,
}: ThemeProductCardProps) {
  const { locale } = useLocale();
  const s = pick(locale, CIRCUIT_STRINGS);
  const digits = useDigitText();
  const data = useCardData(product);

  return (
    <article className="group relative flex h-full min-w-0 overflow-hidden rounded-lg border border-border bg-card shadow-card transition duration-200 hover:shadow-lift">
      <Link
        href={`/product/${product.slug}`}
        className="relative block w-[40%] shrink-0 self-stretch overflow-hidden bg-surface-2"
        aria-label={product.title.bn}
      >
        {data.imageUrl ? (
          <Image
            src={data.imageUrl}
            alt={product.images[0]?.altBn ?? product.title.bn}
            fill
            sizes="(max-width: 768px) 40vw, 20vw"
            loading="lazy"
            className={`object-cover transition duration-300 group-hover:scale-[1.04] ${data.inStock ? "" : "opacity-60 grayscale"}`}
          />
        ) : (
          <div
            className={`flex h-full w-full items-center justify-center bg-muted text-primary/40 ${data.inStock ? "" : "opacity-60 grayscale"}`}
          >
            <DevicePlaceholder />
          </div>
        )}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col px-4 py-3.5">
        <div className="flex items-start justify-between gap-2">
          {data.typeBadgeLabel ? (
            <TypeFlag label={data.typeBadgeLabel} />
          ) : (
            <span />
          )}
          {data.discountPct > 0 && !data.priceOnRequest ? (
            <SavingPill savePoisha={data.savePoisha} pct={data.discountPct} digits={digits} />
          ) : null}
        </div>
        <Link href={`/product/${product.slug}`} className="mt-2 block min-w-0">
          {product.brandName ? (
            <p className="truncate text-[11px] font-semibold tracking-wide text-text-subtle">
              {product.brandName}
            </p>
          ) : null}
          <h3 className="line-clamp-2 break-words text-left text-[15px] font-semibold leading-snug text-text-main [overflow-wrap:anywhere]">
            {product.title.bn}
          </h3>
          <div className="mt-2">
            <PriceRow data={data} digits={digits} />
          </div>
          {!data.inStock ? (
            <p className="mt-1 text-xs font-medium text-destructive">{s.outOfStock}</p>
          ) : null}
        </Link>
        <div className="mt-auto pt-3">
          <CircuitAddButton product={product} data={data} />
        </div>
      </div>
    </article>
  );
}

export default CircuitProductCard;
