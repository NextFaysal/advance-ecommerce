"use client";

/**
 * Haat Header (doc 27 theme T-A) — ThemeHeaderProps.
 *
 * A solid-orange, search-led marketplace header in two tiers:
 * - Utility tier (slim, deep orange): REAL links only — Track
 *   Order (/track), Sign In (/account), Register (/account — the
 *   platform's account page hosts both sign-in and registration,
 *   there is no separate register route), Cart (/cart). A short
 *   own line sits on the left on wide screens.
 * - Main tier (primary orange): store mark + name left, a VERY
 *   wide search centre (plain GET form to /search?q= — the same
 *   contract SiteHeader uses), and a cart button right with a
 *   white count badge. The cart button OPENS this package's cart
 *   drawer (cart-drawer-events); the /cart page stays reachable
 *   from the utility tier.
 *
 * There is deliberately NO category bar: this layout is
 * search-led, and the home/shop pages carry the category
 * discovery surfaces. The `categories` / `headerMenu` props are
 * therefore accepted by the contract but not rendered here.
 *
 * Counts mirror SiteHeader's data path exactly: guest cart from
 * localStorage (@/cart/persistence + @/cart/types), refreshed on
 * storage/focus and on the cart's CART_UPDATED_EVENT. SSR renders
 * no badge (values load after mount), avoiding hydration
 * mismatch — same discipline as SiteHeader. No wishlist count is
 * shown: this header's design carries no wishlist action.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { GUEST_CART_KEY, loadGuestCart } from "@/cart/persistence";
import { cartItemCount } from "@/cart/types";
import { CART_UPDATED_EVENT } from "@/cart/components/AddToCartButton";
import { Icon } from "@/components/ui/icon";
import { useDigitText } from "@/components/ui/numerals";
import { openCartDrawer } from "../cart-drawer-events";
import { HAAT_COLORS } from "./tokens";
import type { ThemeHeaderProps } from "../slots";

function CountBadge({ count, digits }: { count: number; digits: (t: string) => string }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-2 -top-2 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-white px-1 text-[11px] font-extrabold text-primary shadow-sm">
      {digits(count > 99 ? "99+" : `${count}`)}
    </span>
  );
}

const UTILITY_LINKS: ReadonlyArray<{ href: string; label: string; hideOnMobile?: boolean }> = [
  { href: "/track", label: "Track Order" },
  { href: "/account", label: "Sign In" },
  { href: "/account", label: "Register", hideOnMobile: true },
  { href: "/cart", label: "Cart" },
];

export default function HaatHeader({
  brandName = "Advance Ecommerce",
  cartCount,
}: ThemeHeaderProps) {
  const digits = useDigitText();
  const [localCartCount, setLocalCartCount] = useState(0);

  // Guest-cart count — SiteHeader's exact data path.
  useEffect(() => {
    function refresh() {
      const cart = loadGuestCart();
      setLocalCartCount(cart ? cartItemCount(cart) : 0);
    }
    refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === GUEST_CART_KEY || e.key === null) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    window.addEventListener(CART_UPDATED_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(CART_UPDATED_EVENT, refresh);
    };
  }, []);

  const effectiveCartCount = cartCount ?? localCartCount;

  return (
    <header className="sticky top-0 z-40 shadow-card">
      {/* Utility tier — slim deep-orange strip, real links only */}
      <div className="text-white" style={{ backgroundColor: HAAT_COLORS.deepOrange }}>
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-4 py-1.5 sm:px-6">
          <p className="hidden truncate text-xs font-medium text-white/90 md:block">
            ঘরে বসে অর্ডার করুন — সারাদেশে হোম ডেলিভারি
          </p>
          <nav aria-label="দ্রুত লিংক" className="ml-auto flex items-center gap-1">
            {UTILITY_LINKS.map((link, i) => (
              <span key={`${link.label}-${link.href}`} className="flex items-center gap-1">
                {i > 0 ? (
                  <span aria-hidden="true" className="h-3 w-px bg-white/30" />
                ) : null}
                <Link
                  href={link.href}
                  className={`whitespace-nowrap px-1.5 py-0.5 text-xs font-medium text-white/90 transition hover:text-white hover:underline ${
                    link.hideOnMobile ? "hidden sm:block" : ""
                  }`}
                >
                  {link.label}
                </Link>
              </span>
            ))}
          </nav>
        </div>
      </div>

      {/* Main tier — solid primary orange: brand, wide search, cart */}
      <div className="bg-primary text-white">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:flex-nowrap">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2"
            aria-label={brandName}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded bg-white text-lg font-extrabold text-primary shadow-sm">
              {brandName.charAt(0)}
            </span>
            <span className="max-w-[10rem] truncate text-lg font-extrabold leading-tight sm:max-w-none">
              {brandName}
            </span>
          </Link>

          {/* Search — plain GET form to /search, SiteHeader's contract. */}
          <form
            action="/search"
            role="search"
            className="order-3 w-full lg:order-2 lg:w-auto lg:flex-1"
          >
            <div className="relative">
              <input
                type="search"
                name="q"
                placeholder="হাটে খুঁজুন… পণ্যের নাম লিখুন"
                aria-label="পণ্য খুঁজুন"
                className="h-11 w-full rounded bg-white pl-4 pr-12 text-sm text-text-main shadow-sm transition placeholder:text-text-subtle focus:outline-none focus:ring-2 focus:ring-white/70"
              />
              <button
                type="submit"
                aria-label="খুঁজুন"
                className="absolute right-1 top-1 flex h-9 w-10 items-center justify-center rounded text-white transition hover:opacity-90"
                style={{ backgroundColor: HAAT_COLORS.deepOrange }}
              >
                <Icon name="search" size={18} />
              </button>
            </div>
          </form>

          {/* Cart — opens the drawer; badge carries the live count */}
          <button
            type="button"
            onClick={openCartDrawer}
            aria-label={`কার্ট${effectiveCartCount > 0 ? `, ${effectiveCartCount}টি পণ্য` : ""} — ড্রয়ার খুলুন`}
            className="order-2 ml-auto flex shrink-0 flex-col items-center gap-0.5 rounded px-2 py-1 text-white transition hover:bg-white/10 lg:order-3 lg:ml-0"
          >
            <span className="relative">
              <Icon name="cart" size={24} />
              <CountBadge count={effectiveCartCount} digits={digits} />
            </span>
            <span className="text-[11px] font-semibold leading-none">কার্ট</span>
          </button>
        </div>
      </div>
    </header>
  );
}
