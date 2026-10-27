"use client";

/**
 * Circuit Header (doc 27 T-D) — ThemeHeaderProps.
 *
 * Tech-store header in two tiers:
 * - Tier 1 (dark navy, our #10222E): brand left; a wide WHITE
 *   search in the centre (plain GET form to /search?q= — the same
 *   contract SiteHeader uses); on the right an Offers link (/shop),
 *   an Account link (/account) and ONE gradient CTA button
 *   (blue → cyan, via the package's --brand-gradient token) linking
 *   to /shop. Every link is real — "Offers" and the CTA both point
 *   at the shop because the platform has no separate offers route;
 *   no dead or invented destinations.
 * - Tier 2 (white): a single-row category bar — "সব ক্যাটাগরি"
 *   plus the root categories from the `categories` prop (each
 *   linking /shop?category=<slug>) and the header menu links —
 *   horizontally scrollable on mobile.
 *
 * Floating edge actions (right side, gated by the package's
 * `showFloatingActions` merchant option): a dark cart button that
 * opens this package's cart drawer (cart-drawer-events) and shows
 * the REAL guest-cart count, and a compare button linking to the
 * platform's real /compare page. No back-to-top or chat buttons —
 * this package's floating set is exactly those two.
 *
 * Counts mirror SiteHeader's data path exactly: guest cart from
 * localStorage (@/cart/persistence + @/cart/types), refreshed on
 * storage/focus and on the cart's CART_UPDATED_EVENT. SSR renders
 * no badge (values load after mount), avoiding hydration mismatch
 * — same discipline as SiteHeader and the Bazaar header.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { GUEST_CART_KEY, loadGuestCart } from "@/cart/persistence";
import { cartItemCount } from "@/cart/types";
import { CART_UPDATED_EVENT } from "@/cart/components/AddToCartButton";
import { Icon } from "@/components/ui/icon";
import { DEFAULT_HEADER_MENU } from "@/cms/site-content-types";
import { useThemeView } from "../theme-view";
import { openCartDrawer } from "../cart-drawer-events";
import { CIRCUIT_COLORS } from "./tokens";
import type { ThemeHeaderProps } from "../slots";

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-white shadow-sm">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export default function CircuitHeader({
  brandName = "Advance Ecommerce",
  cartCount,
  categories,
  headerMenu,
}: ThemeHeaderProps) {
  const themeView = useThemeView();
  const showFloatingActions = themeView.options.showFloatingActions !== false;

  const [localCartCount, setLocalCartCount] = useState(0);

  // Guest-cart count — SiteHeader's exact data path. The compare
  // tray's count is not part of the header props, so the floating
  // compare button carries no badge rather than an invented one.
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
  const menu = headerMenu && headerMenu.length > 0 ? headerMenu : DEFAULT_HEADER_MENU;

  return (
    <>
      <header className="sticky top-0 z-40 shadow-card">
        {/* Tier 1 — dark navy: brand, white search, offers/account/CTA */}
        <div style={{ backgroundColor: CIRCUIT_COLORS.navy }}>
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:flex-nowrap">
            <Link
              href="/"
              className="flex shrink-0 items-center gap-2"
              aria-label={brandName}
            >
              <span className="brand-gradient flex h-10 w-10 items-center justify-center rounded-lg text-lg font-bold text-white shadow-sm">
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
                  placeholder="পণ্য খুঁজুন… যেমন: ল্যাপটপ, মনিটর, রাউটার, হেডফোন"
                  aria-label="পণ্য খুঁজুন"
                  className="h-11 w-full rounded-lg border border-white/20 bg-white pl-4 pr-12 text-sm text-[#1B2A36] shadow-sm transition placeholder:text-[#7A8C9C] focus:outline-none focus:ring-2 focus:ring-primary/60"
                />
                <button
                  type="submit"
                  aria-label="খুঁজুন"
                  className="absolute right-1 top-1 flex h-9 w-10 items-center justify-center rounded-md bg-primary text-white transition hover:opacity-90"
                >
                  <Icon name="search" size={18} />
                </button>
              </div>
            </form>

            {/* Right cluster — Offers, Account, gradient CTA */}
            <div className="order-2 ml-auto flex shrink-0 items-center gap-1 sm:gap-2 lg:order-3 lg:ml-0">
              <Link
                href="/shop"
                className="flex min-w-[52px] flex-col items-center gap-0.5 rounded-md px-1.5 py-1 text-white/85 transition hover:text-white"
              >
                <Icon name="tag" size={22} />
                <span className="text-[11px] font-medium leading-none">অফার</span>
              </Link>
              <Link
                href="/account"
                className="flex min-w-[52px] flex-col items-center gap-0.5 rounded-md px-1.5 py-1 text-white/85 transition hover:text-white"
              >
                <Icon name="user" size={22} />
                <span className="text-[11px] font-medium leading-none">অ্যাকাউন্ট</span>
              </Link>
              <Link
                href="/shop"
                className="brand-gradient ml-1 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-4 text-sm font-bold text-white shadow-md transition hover:opacity-95"
              >
                সব অফার
                <Icon name="arrow-right" size={16} />
              </Link>
            </div>
          </div>
        </div>

        {/* Tier 2 — white single-row category bar */}
        <nav aria-label="ক্যাটাগরি" className="border-b border-border bg-card">
          <div className="scrollbar-none mx-auto flex max-w-[1440px] items-center gap-1 overflow-x-auto px-4 sm:px-6">
            <Link
              href="/shop"
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm font-bold text-text-main transition hover:text-primary"
            >
              <Icon name="grid" size={16} />
              সব ক্যাটাগরি
            </Link>
            {(categories ?? []).map((c) => (
              <Link
                key={c.slug}
                href={`/shop?category=${c.slug}`}
                className="shrink-0 whitespace-nowrap px-3 py-2.5 text-sm font-medium text-text-muted transition hover:text-primary"
              >
                {c.name.bn}
              </Link>
            ))}
            <span aria-hidden="true" className="mx-1 hidden h-5 w-px shrink-0 bg-border md:block" />
            {menu.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="hidden shrink-0 whitespace-nowrap px-3 py-2.5 text-sm font-medium text-text-muted transition hover:text-primary md:block"
              >
                {item.labelBn}
              </Link>
            ))}
          </div>
        </nav>
      </header>

      {/* Floating edge actions — dark navy buttons on the right
          edge: cart (opens the drawer, real count badge) and
          compare (the platform's real /compare page). Gated by
          the package's showFloatingActions option. */}
      {showFloatingActions ? (
        <div className="fixed right-0 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-2">
          <button
            type="button"
            onClick={openCartDrawer}
            aria-label={`কার্ট${effectiveCartCount > 0 ? `, ${effectiveCartCount}টি পণ্য` : ""} — ড্রয়ার খুলুন`}
            className="relative flex h-12 w-12 items-center justify-center rounded-l-xl text-white shadow-pop transition hover:opacity-95"
            style={{ backgroundColor: CIRCUIT_COLORS.navy }}
          >
            <Icon name="cart" size={21} />
            <CountBadge count={effectiveCartCount} />
          </button>
          <Link
            href="/compare"
            aria-label="পণ্য তুলনা করুন"
            className="relative flex h-12 w-12 items-center justify-center rounded-l-xl text-white shadow-pop transition hover:opacity-95"
            style={{ backgroundColor: CIRCUIT_COLORS.navy }}
          >
            <Icon name="refresh-ccw" size={20} />
          </Link>
        </div>
      ) : null}
    </>
  );
}
