"use client";

/**
 * Wishlist toggle for the product detail page (PDP).
 *
 * Uses the SAME guest wishlist mechanism as ProductCard — the
 * localStorage id list in src/catalog/wishlist.ts (getWishlistIds /
 * toggleWishlistId), so a product wishlisted here shows wishlisted on
 * its card, on /wishlist, and in the header count, and vice versa.
 * Initial state is read from the store on mount (cards start un-synced
 * until clicked; this button syncs on mount AND on the wishlist change
 * event, so it also reflects toggles made elsewhere in the tab).
 *
 * Props are plain data (productId) — safe to render from the
 * server-component PDP.
 */
import { useEffect, useState } from "react";
import { pick } from "@/i18n/locale";
import { useLocale } from "@/i18n/LocaleProvider";
import { WISHLIST_CHANGE_EVENT, getWishlistIds, toggleWishlistId } from "./wishlist";
import { CATALOG_STRINGS } from "./strings";

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="17"
      height="17"
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

export function WishlistToggleButton({ productId }: { productId: string }) {
  const { locale } = useLocale();
  const s = pick(locale, CATALOG_STRINGS);
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
      aria-pressed={wishlisted}
      aria-label={wishlisted ? s.wishlistRemove : s.wishlistAdd}
      onClick={() => {
        const next = toggleWishlistId(productId);
        setWishlisted(next.includes(productId));
      }}
      className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg border px-4 py-3 text-sm transition ${
        wishlisted
          ? "border-rose-300 bg-rose-50 font-semibold text-rose-600"
          : "border-border text-text-main hover:bg-surface-2"
      }`}
    >
      <HeartIcon filled={wishlisted} />
      {wishlisted ? s.wishlistIn : s.wishlistKeep}
    </button>
  );
}
