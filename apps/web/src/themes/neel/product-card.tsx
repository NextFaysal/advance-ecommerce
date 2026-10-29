"use client";

/**
 * Neel ProductCard (doc 27 T-E) — ThemeProductCardProps { product }.
 *
 * Classic marketplace anatomy: white card, thin border, small
 * radius, big square photo, left-aligned 2-line title with a
 * wishlist heart button, an orange star row when the product has
 * real reviews, a bold BLACK price (the foreground token — not the
 * brand blue) with a grey strikethrough compare-at, and an action
 * row with Add To Cart + Buy Now.
 *
 * Wishlist: the heart is the platform's REAL wishlist toggle —
 * the same localStorage list Aurora's ProductCard uses
 * (@/catalog/wishlist: getWishlistIds / toggleWishlistId, synced
 * via WISHLIST_CHANGE_EVENT) — so a heart set here shows in the
 * header count and on /wishlist.
 *
 * Ratings: PublicProduct carries `ratingAverage` + `reviewCount`;
 * the star row renders ONLY when ratingAverage !== null &&
 * reviewCount > 0. No rating is ever invented for a reviewless
 * product.
 *
 * Badges — only from signals PublicProduct really carries:
 * - LEFT, orange %-off badge: the discount percentage from the
 *   default variant's compareAtPoisha vs the minimum variant
 *   price — rendered only when a real compare-at discount exists.
 * - Type flag (PRODUCT_TYPE_BADGE_LABEL) for non-SIMPLE products,
 *   stacked under the %-off badge — the same signal Aurora badges.
 *   PublicProduct exposes NO bestseller / new-arrival / flash
 *   flag, so this card never prints those labels.
 * - Out of stock: a "স্টক শেষ" chip + disabled actions.
 *
 * Cart wiring is NOT re-implemented: both buttons go through the
 * platform's addItemToGuestCart() (same guest-cart contract, same
 * CART_UPDATED_EVENT). Add To Cart then opens this package's cart
 * drawer (cart-drawer-events); Buy Now navigates to /checkout —
 * and only when units were actually added. Price-on-request
 * products show the contact label and no purchase buttons, like
 * the other packages' cards.
 *
 * `NeelProductCardHorizontal` is the home rail variant (packshot
 * left ~40%, details right, same anatomy). It is composition-
 * internal to this package (home sections import it directly) and
 * deliberately NOT part of the ProductCard slot contract.
 *
 * Doc 33 R6 (mobile-first floors): wishlist heart 36→44px on phone
 * (36px restored at lg), Add/Buy-Now buttons 44px on phone (40px
 * at lg), brand meta 11→12px, compare-at ≥14px on phone. The
 * review count and the %-off/type badges stay 11px by design.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { formatBdt } from "@advance-ecommerce/validators";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { NEEL_STRINGS } from "./strings";
import { useDigitText } from "@/components/ui/numerals";
import { Icon } from "@/components/ui/icon";
import { Stars } from "@/reviews/components/Stars";
import type { PublicProduct } from "@/catalog/types";
import { minVariantPricePoisha } from "@/catalog/types";
import {
  PRODUCT_TYPE_BADGE_LABEL,
  productTypeOf,
  type PublicProductWithTypeFields,
} from "@/catalog/product-type-contract";
import {
  WISHLIST_CHANGE_EVENT,
  getWishlistIds,
  toggleWishlistId,
} from "@/catalog/wishlist";
import { addItemToGuestCart } from "@/cart/components/AddToCartButton";
import { openCartDrawer } from "../cart-drawer-events";
import { NEEL_COLORS } from "./tokens";
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
  const discountPct =
    compareAt !== null && compareAt > price && price > 0
      ? Math.round(((compareAt - price) / compareAt) * 100)
      : 0;
  const imageUrl = product.images[0]?.url ?? defaultVariant?.imageUrl ?? null;
  const cardType = productTypeOf(product as PublicProductWithTypeFields);
  const typeBadgeLabel =
    cardType !== "SIMPLE" ? PRODUCT_TYPE_BADGE_LABEL[cardType] : null;
  // Real review data only — both fields exist on PublicProduct.
  const hasRating = product.ratingAverage !== null && product.reviewCount > 0;
  return {
    price,
    inStock,
    defaultVariant,
    compareAt,
    discountPct,
    imageUrl,
    typeBadgeLabel,
    priceOnRequest: product.priceOnRequest,
    hasRating,
    ratingAverage: product.ratingAverage,
    reviewCount: product.reviewCount,
  };
}

type CardData = ReturnType<typeof useCardData>;

function OffBadge({ pct, digits }: { pct: number; digits: (t: string) => string }) {
  const { locale } = useLocale();
  const s = pick(locale, NEEL_STRINGS);
  return (
    <span
      className="rounded-sm px-1.5 py-0.5 text-[11px] font-bold text-white shadow-sm"
      style={{ backgroundColor: NEEL_COLORS.accentOrange }}
    >
      {digits(interpolate(s.offBadge, { pct }))}
    </span>
  );
}

function TypeFlag({ label }: { label: string }) {
  return (
    <span className="rounded-sm bg-primary px-1.5 py-0.5 text-[11px] font-bold text-white shadow-sm">
      {label}
    </span>
  );
}

/** Our own bag-outline placeholder (drawn in-house) for products
 *  without catalogue imagery — never a broken image. */
function BagPlaceholder() {
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

/** The real wishlist heart — toggles the platform's wishlist list
 *  and stays in sync with toggles made anywhere else. */
function WishlistHeart({ productId, title }: { productId: string; title: { bn: string; en: string } }) {
  const { locale } = useLocale();
  const s = pick(locale, NEEL_STRINGS);
  const [wishlisted, setWishlisted] = useState(false);

  useEffect(() => {
    const sync = () => setWishlisted(getWishlistIds().includes(productId));
    sync();
    window.addEventListener(WISHLIST_CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(WISHLIST_CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [productId]);

  return (
    <button
      type="button"
      aria-label={wishlisted ? interpolate(s.wishlistRemoveAria, { title: title[locale] || title.bn }) : interpolate(s.wishlistAddAria, { title: title[locale] || title.bn })}
      aria-pressed={wishlisted}
      onClick={() => {
        toggleWishlistId(productId);
        setWishlisted((w) => !w);
      }}
      className={`flex h-11 w-11 items-center justify-center rounded-full shadow-card ring-1 transition active:scale-95 lg:h-9 lg:w-9 ${
        wishlisted
          ? "bg-accent text-white ring-accent"
          : "bg-card text-text-muted ring-border hover:text-accent"
      }`}
    >
      <Icon name="heart" size={17} />
    </button>
  );
}

/** Shared add path for both buttons: the platform helper, then the
 *  caller's follow-up (drawer / checkout) only on a real add. */
function useAddActions(product: PublicProduct, data: CardData) {
  const router = useRouter();
  const [justAdded, setJustAdded] = useState(false);
  const { defaultVariant } = data;

  function add(): boolean {
    if (!defaultVariant) return false;
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
    return result.addedQuantity > 0;
  }

  return {
    justAdded,
    addToCart() {
      if (!add()) return;
      setJustAdded(true);
      window.setTimeout(() => setJustAdded(false), 2000);
      openCartDrawer();
    },
    buyNow() {
      if (add()) router.push("/checkout");
    },
  };
}

function ActionRow({
  product,
  data,
}: {
  product: PublicProduct;
  data: CardData;
}) {
  const { locale } = useLocale();
  const s = pick(locale, NEEL_STRINGS);
  const { addToCart, buyNow, justAdded } = useAddActions(product, data);
  if (!data.defaultVariant || data.priceOnRequest) return null;
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={addToCart}
        disabled={!data.inStock}
        aria-live="polite"
        className={`flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-[13px] font-bold transition active:scale-[0.98] lg:min-h-[40px] ${
          data.inStock
            ? "border-primary bg-card text-primary hover:bg-primary hover:text-white"
            : "cursor-not-allowed border-border bg-muted text-text-subtle"
        }`}
      >
        <Icon name="cart" size={15} />
        {!data.inStock ? s.outOfStock : justAdded ? s.addedShort : s.addToCartLabel}
      </button>
      <button
        type="button"
        onClick={buyNow}
        disabled={!data.inStock}
        className="flex min-h-[44px] flex-1 items-center justify-center rounded-md bg-accent px-2 py-2 text-[13px] font-bold text-white transition hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-[40px]"
      >
        {s.buyNowLabel}
      </button>
    </div>
  );
}

function RatingRow({ data }: { data: CardData }) {
  if (!data.hasRating) return null;
  return (
    <div className="mt-1 flex items-center gap-1.5">
      <Stars rating={data.ratingAverage ?? 0} size={13} />
      <span className="text-xs font-medium tabular-nums text-text-subtle">
        ({data.reviewCount})
      </span>
    </div>
  );
}

function PriceRow({ data, digits }: { data: CardData; digits: (t: string) => string }) {
  const { locale } = useLocale();
  const priceOnRequestLabel = pick(locale, NEEL_STRINGS).priceOnRequest;
  if (data.priceOnRequest) {
    return (
      <p className="text-[15px] font-extrabold text-primary">{priceOnRequestLabel}</p>
    );
  }
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      {/* Bold BLACK price — the foreground token, this package's
          card signature (the brand blue stays on actions/badges). */}
      <span className="text-[17px] font-extrabold tabular-nums text-text-main">
        {digits(formatBdt(data.price))}
      </span>
      {data.compareAt !== null && data.compareAt > data.price ? (
        <span className="text-sm tabular-nums text-text-subtle line-through lg:text-[13px]">
          {digits(formatBdt(data.compareAt))}
        </span>
      ) : null}
    </p>
  );
}

/** Standard (vertical) card — the ProductCard slot implementation. */
export function NeelProductCard({ product }: ThemeProductCardProps) {
  const { locale } = useLocale();
  const s = pick(locale, NEEL_STRINGS);
  const digits = useDigitText();
  const data = useCardData(product);

  return (
    <article className="group relative flex h-full min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card shadow-card transition duration-200 hover:shadow-lift">
      <div className="relative">
        <Link href={`/product/${product.slug}`} className="block min-w-0">
          <div className="relative aspect-square overflow-hidden bg-surface-2">
            {data.imageUrl ? (
              <Image
                src={data.imageUrl}
                alt={(locale === "en" ? product.images[0]?.altEn || product.images[0]?.altBn : product.images[0]?.altBn) ?? (product.title[locale] || product.title.bn)}
                fill
                sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
                loading="lazy"
                className={`object-cover transition duration-300 group-hover:scale-[1.04] ${data.inStock ? "" : "opacity-60 grayscale"}`}
              />
            ) : (
              <div
                className={`flex h-full w-full items-center justify-center bg-muted text-primary/40 ${data.inStock ? "" : "opacity-60 grayscale"}`}
              >
                <BagPlaceholder />
              </div>
            )}
            {!data.inStock ? (
              <span className="absolute bottom-2 left-2 rounded-sm bg-text-main/85 px-2 py-0.5 text-[11px] font-semibold text-white">
                {s.outOfStock}
              </span>
            ) : null}
          </div>
        </Link>
        {/* Badges — left column, real signals only */}
        <div className="absolute left-2 top-2 z-[5] flex flex-col items-start gap-1">
          {data.discountPct > 0 && !data.priceOnRequest ? (
            <OffBadge pct={data.discountPct} digits={digits} />
          ) : null}
          {data.typeBadgeLabel ? <TypeFlag label={data.typeBadgeLabel} /> : null}
        </div>
        {/* Wishlist heart — the platform's real toggle */}
        <span className="absolute right-2 top-2 z-[5]">
          <WishlistHeart productId={product.id} title={product.title} />
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col px-3 pb-3 pt-3">
        <Link href={`/product/${product.slug}`} className="block min-w-0">
          {product.brandName ? (
            <p className="truncate text-xs font-semibold tracking-wide text-text-subtle">
              {product.brandName}
            </p>
          ) : null}
          <h3 className="line-clamp-2 min-h-[2.6em] break-words text-left text-sm font-semibold leading-snug text-text-main [overflow-wrap:anywhere]">
            {product.title[locale] || product.title.bn}
          </h3>
          <RatingRow data={data} />
          <div className="mt-1.5">
            <PriceRow data={data} digits={digits} />
          </div>
        </Link>
        <div className="mt-auto pt-2.5">
          <ActionRow product={product} data={data} />
        </div>
      </div>
    </article>
  );
}

/**
 * Horizontal variant for the home featured rail: image left
 * (~40%), details right — same badges, rating gate, price anatomy
 * and actions as the standard card.
 */
export function NeelProductCardHorizontal({ product }: ThemeProductCardProps) {
  const { locale } = useLocale();
  const s = pick(locale, NEEL_STRINGS);
  const digits = useDigitText();
  const data = useCardData(product);

  return (
    <article className="group relative flex h-full min-w-0 overflow-hidden rounded-md border border-border bg-card shadow-card transition duration-200 hover:shadow-lift">
      <Link
        href={`/product/${product.slug}`}
        className="relative block w-[40%] shrink-0 self-stretch overflow-hidden bg-surface-2"
        aria-label={product.title[locale] || product.title.bn}
      >
        {data.imageUrl ? (
          <Image
            src={data.imageUrl}
            alt={(locale === "en" ? product.images[0]?.altEn || product.images[0]?.altBn : product.images[0]?.altBn) ?? (product.title[locale] || product.title.bn)}
            fill
            sizes="(max-width: 768px) 40vw, 20vw"
            loading="lazy"
            className={`object-cover transition duration-300 group-hover:scale-[1.04] ${data.inStock ? "" : "opacity-60 grayscale"}`}
          />
        ) : (
          <div
            className={`flex h-full w-full items-center justify-center bg-muted text-primary/40 ${data.inStock ? "" : "opacity-60 grayscale"}`}
          >
            <BagPlaceholder />
          </div>
        )}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col items-start gap-1">
            {data.discountPct > 0 && !data.priceOnRequest ? (
              <OffBadge pct={data.discountPct} digits={digits} />
            ) : null}
            {data.typeBadgeLabel ? <TypeFlag label={data.typeBadgeLabel} /> : null}
          </div>
          <WishlistHeart productId={product.id} title={product.title} />
        </div>
        <Link href={`/product/${product.slug}`} className="mt-1.5 block min-w-0">
          {product.brandName ? (
            <p className="truncate text-xs font-semibold tracking-wide text-text-subtle">
              {product.brandName}
            </p>
          ) : null}
          <h3 className="line-clamp-2 break-words text-left text-sm font-semibold leading-snug text-text-main [overflow-wrap:anywhere]">
            {product.title[locale] || product.title.bn}
          </h3>
          <RatingRow data={data} />
          <div className="mt-1.5">
            <PriceRow data={data} digits={digits} />
          </div>
          {!data.inStock ? (
            <p className="mt-1 text-xs font-medium text-destructive">{s.outOfStock}</p>
          ) : null}
        </Link>
        <div className="mt-auto pt-2.5">
          <ActionRow product={product} data={data} />
        </div>
      </div>
    </article>
  );
}

export default NeelProductCard;
