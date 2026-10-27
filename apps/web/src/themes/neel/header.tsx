"use client";

/**
 * Neel Header (doc 27 T-E) — ThemeHeaderProps.
 *
 * Two tiers, classic marketplace shape:
 * - A slim pale top strip: a short delivery line on the left and
 *   real text links on the right — আমাদের সম্পর্কে (/about),
 *   Track Order (/track), Sign In (/account), Register (/account —
 *   the account page carries both forms; there is no separate
 *   register route), সাহায্য (/kb). Every href was checked against
 *   the app routes; nothing decorative is linked anywhere.
 * - The main tier sits on this package's blue gradient: the store
 *   name in white, a wide white search box (plain GET form to
 *   /search?q= — the same contract SiteHeader uses), then text
 *   links Sign In / Register and the Wishlist / Compare / Cart
 *   icon buttons with count badges. /compare is a real route of
 *   this app, so the Compare button is shown. The cart button
 *   OPENS this package's cart drawer (cart-drawer-events), like
 *   the other drawer-owning packages; /cart stays for deep links.
 *
 * The package's signature CIRCULAR category row is part of the
 * home composition (home-sections.tsx), not this header, so on
 * non-home pages the header alone carries the chrome.
 *
 * Counts mirror SiteHeader's data path exactly: guest cart from
 * localStorage (@/cart/persistence + @/cart/types), wishlist from
 * @/catalog/wishlist, refreshed on storage/focus and on the cart's
 * CART_UPDATED_EVENT. SSR renders no badges (values load after
 * mount), avoiding hydration mismatch — same discipline as
 * SiteHeader. No dark-mode toggle: the package is light-first
 * (supportsDark: false).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { WISHLIST_CHANGE_EVENT, getWishlistIds } from "@/catalog/wishlist";
import { GUEST_CART_KEY, loadGuestCart } from "@/cart/persistence";
import { cartItemCount } from "@/cart/types";
import { CART_UPDATED_EVENT } from "@/cart/components/AddToCartButton";
import { Icon } from "@/components/ui/icon";
import { openCartDrawer } from "../cart-drawer-events";
import { NEEL_HEADER_GRADIENT } from "./tokens";
import type { ThemeHeaderProps } from "../slots";

function WhiteBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold text-white shadow-sm">
      {count > 99 ? "99+" : count}
    </span>
  );
}

const STRIP_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/about", label: "আমাদের সম্পর্কে" },
  { href: "/track", label: "Track Order" },
  { href: "/account", label: "Sign In" },
  { href: "/account", label: "Register" },
  { href: "/kb", label: "সাহায্য" },
];

export default function NeelHeader({
  brandName = "Advance Ecommerce",
  cartCount,
}: ThemeHeaderProps) {
  const [localCartCount, setLocalCartCount] = useState(0);
  const [wishlistCount, setWishlistCount] = useState(0);

  // Guest-cart + wishlist counts — SiteHeader's exact data path.
  useEffect(() => {
    function refresh() {
      const cart = loadGuestCart();
      setLocalCartCount(cart ? cartItemCount(cart) : 0);
      setWishlistCount(getWishlistIds().length);
    }
    refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === GUEST_CART_KEY || e.key === null) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    window.addEventListener(CART_UPDATED_EVENT, refresh);
    window.addEventListener(WISHLIST_CHANGE_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(CART_UPDATED_EVENT, refresh);
      window.removeEventListener(WISHLIST_CHANGE_EVENT, refresh);
    };
  }, []);

  const effectiveCartCount = cartCount ?? localCartCount;

  return (
    <header className="sticky top-0 z-40 shadow-card">
      {/* Slim pale top strip — real links only */}
      <div className="bg-surface-2 text-text-muted">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-4 py-1.5 text-xs sm:px-6">
          <span className="hidden truncate font-medium sm:block">
            সারা দেশে হোম ডেলিভারি — অর্ডার করুন ঘরে বসেই
          </span>
          <nav aria-label="দ্রুত লিংক" className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {STRIP_LINKS.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                className="font-medium transition hover:text-primary"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {/* Main tier — blue gradient: brand, search, actions */}
      <div style={{ backgroundImage: NEEL_HEADER_GRADIENT }}>
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-6 lg:flex-nowrap">
          <Link href="/" className="flex shrink-0 items-center gap-2" aria-label={brandName}>
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-white/15 text-lg font-bold text-white ring-1 ring-white/30">
              {brandName.charAt(0)}
            </span>
            <span className="max-w-[10rem] truncate text-lg font-bold leading-tight text-white sm:max-w-none">
              {brandName}
            </span>
          </Link>

          {/* Search — GET form to /search, SiteHeader's contract. */}
          <form
            action="/search"
            role="search"
            className="order-3 w-full lg:order-2 lg:w-auto lg:flex-1"
          >
            <div className="relative">
              <input
                type="search"
                name="q"
                placeholder="পণ্য খুঁজুন… যেমন: শাড়ি, মোবাইল, জুতা"
                aria-label="পণ্য খুঁজুন"
                className="h-11 w-full rounded-md border border-white/40 bg-white pl-4 pr-12 text-sm text-text-main shadow-sm transition placeholder:text-text-subtle focus:outline-none focus:ring-2 focus:ring-white/60"
              />
              <button
                type="submit"
                aria-label="খুঁজুন"
                className="absolute right-1 top-1 flex h-9 w-10 items-center justify-center rounded-sm bg-accent text-white transition hover:opacity-90"
              >
                <Icon name="search" size={18} />
              </button>
            </div>
          </form>

          {/* Sign In / Register text links + icon actions */}
          <div className="order-2 ml-auto flex shrink-0 items-center gap-1 sm:gap-2 lg:order-3 lg:ml-0">
            <div className="mr-1 hidden flex-col items-end leading-tight md:flex">
              <Link href="/account" className="text-[13px] font-bold text-white transition hover:underline">
                Sign In
              </Link>
              <Link href="/account" className="text-[11px] font-medium text-white/75 transition hover:text-white hover:underline">
                Register
              </Link>
            </div>
            <Link
              href="/wishlist"
              aria-label={`উইশলিস্ট${wishlistCount > 0 ? `, ${wishlistCount}টি পণ্য` : ""}`}
              className="relative flex min-w-[52px] flex-col items-center gap-0.5 rounded-md px-1.5 py-1 text-white/90 transition hover:bg-white/10 hover:text-white"
            >
              <span className="relative">
                <Icon name="heart" size={23} />
                <WhiteBadge count={wishlistCount} />
              </span>
              <span className="text-[11px] font-medium leading-none">Wishlist</span>
            </Link>
            <Link
              href="/compare"
              aria-label="তুলনা দেখুন"
              className="relative flex min-w-[52px] flex-col items-center gap-0.5 rounded-md px-1.5 py-1 text-white/90 transition hover:bg-white/10 hover:text-white"
            >
              <Icon name="refresh-ccw" size={23} />
              <span className="text-[11px] font-medium leading-none">Compare</span>
            </Link>
            <button
              type="button"
              onClick={openCartDrawer}
              aria-label={`কার্ট${effectiveCartCount > 0 ? `, ${effectiveCartCount}টি পণ্য` : ""} — ড্রয়ার খুলুন`}
              className="relative flex min-w-[52px] flex-col items-center gap-0.5 rounded-md px-1.5 py-1 text-white/90 transition hover:bg-white/10 hover:text-white"
            >
              <span className="relative">
                <Icon name="cart" size={23} />
                <WhiteBadge count={effectiveCartCount} />
              </span>
              <span className="text-[11px] font-medium leading-none">Cart</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
