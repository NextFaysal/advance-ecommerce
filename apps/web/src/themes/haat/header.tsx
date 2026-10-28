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
 * discovery surfaces. On PHONE the discovery path is the shared
 * MobileMenuDrawer (doc 33 §3.3): a hamburger in the main tier
 * opens it, fed by the `categories` / `headerMenu` props this
 * header previously accepted without rendering.
 *
 * Doc 33 R2 — sticky budget (§3.3): the utility tier scrolls away
 * and only the main tier carries `sticky` below `lg` (the two are
 * siblings so the sticky tier's containing block is the page, not
 * the short header box). Stuck phone height ≈ 112px: py-2 + the
 * brand/actions row + the full-width search row. At `lg`+ the
 * main tier is one row; desktop geometry is otherwise unchanged.
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
import { LanguageSwitcher } from "@/i18n/LanguageSwitcher";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { HAAT_STRINGS } from "./strings";
import { MobileMenuDrawer } from "@/storefront-ux/components/MobileMenuDrawer";
import type { ThemeHeaderProps } from "../slots";

function CountBadge({ count, digits }: { count: number; digits: (t: string) => string }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-2 -top-2 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-white px-1 text-[11px] font-extrabold text-primary shadow-sm">
      {digits(count > 99 ? "99+" : `${count}`)}
    </span>
  );
}

export default function HaatHeader({
  brandName = "Advance Ecommerce",
  cartCount,
  categories,
  headerMenu,
}: ThemeHeaderProps) {
  const { locale } = useLocale();
  const s = pick(locale, HAAT_STRINGS);
  const utilityLinks: ReadonlyArray<{ href: string; label: string; hideOnMobile?: boolean }> = [
    { href: "/track", label: s.trackOrderLink },
    { href: "/account", label: s.signInLink },
    { href: "/account", label: s.registerLink, hideOnMobile: true },
    { href: "/cart", label: s.cartLink },
  ];
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
    <>
      {/* Utility tier — slim deep-orange strip, real links only.
          NOT sticky (doc 33 §3.3): it scrolls away on every page;
          its links carry the 44px touch floor on phone only, so
          the desktop strip stays slim. */}
      <div className="text-white" style={{ backgroundColor: HAAT_COLORS.deepOrange }}>
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:py-1.5">
          <p className="hidden truncate text-xs font-medium text-white/90 md:block">
            {s.utilityTagline}
          </p>
          <nav aria-label={s.quickLinksAria} className="ml-auto flex items-center gap-1">
            {utilityLinks.map((link, i) => (
              <span key={`${link.label}-${link.href}`} className="flex items-center gap-1">
                {i > 0 ? (
                  <span aria-hidden="true" className="h-3 w-px bg-white/30" />
                ) : null}
                <Link
                  href={link.href}
                  className={`flex min-h-[44px] items-center whitespace-nowrap px-1.5 text-xs font-medium text-white/90 transition hover:text-white hover:underline lg:min-h-0 lg:py-0.5 ${
                    link.hideOnMobile ? "hidden sm:flex" : ""
                  }`}
                >
                  {link.label}
                </Link>
              </span>
            ))}
          </nav>
        </div>
      </div>

      {/* Main tier — solid primary orange: brand, wide search, cart.
          THE sticky tier (doc 33 §3.3): sibling of the utility
          strip, so it parks at the viewport top for the whole page
          while the strip scrolls away above it. */}
      <header className="sticky top-0 z-40 bg-primary text-white shadow-card">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6 lg:flex-nowrap lg:py-3">
          {/* Mobile menu (doc 33 §3.3) — the shared drawer, dressed
              as a white chip mirroring the brand mark; it carries
              the menu + categories this search-led header has no
              bar for. The switcher rides in its footer slot AND
              stays in the tier below (every-width rule). */}
          <MobileMenuDrawer
            brandName={brandName}
            headerMenu={headerMenu}
            categories={categories}
            footer={<LanguageSwitcher />}
            triggerClassName="order-1 -ml-1.5 shrink-0 bg-white shadow-sm"
          />

          <Link
            href="/"
            className="order-1 flex min-h-[44px] shrink-0 items-center gap-2"
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
                placeholder={s.searchPlaceholder}
                aria-label={s.searchProductAria}
                className="h-11 w-full rounded bg-white pl-4 pr-12 text-sm text-text-main shadow-sm transition placeholder:text-text-subtle focus:outline-none focus:ring-2 focus:ring-white/70"
              />
              <button
                type="submit"
                aria-label={s.searchSubmitAria}
                className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded text-white transition hover:opacity-90"
                style={{ backgroundColor: HAAT_COLORS.deepOrange }}
              >
                <Icon name="search" size={18} />
              </button>
            </div>
          </form>

          {/* Language switcher — sits in the main tier beside the
              cart, visible at every width (this row wraps but never
              collapses into a menu). */}
          <LanguageSwitcher className="order-2 ml-auto self-center lg:order-3 lg:ml-0" />

          {/* Cart — opens the drawer; badge carries the live count */}
          <button
            type="button"
            onClick={openCartDrawer}
            aria-label={
              effectiveCartCount > 0
                ? interpolate(s.cartAriaWithCount, { count: effectiveCartCount })
                : s.cartAriaEmpty
            }
            className="order-2 ml-auto flex min-h-[44px] shrink-0 flex-col items-center justify-center gap-0.5 rounded px-2 py-1 text-white transition hover:bg-white/10 lg:order-3 lg:ml-0"
          >
            <span className="relative">
              <Icon name="cart" size={24} />
              <CountBadge count={effectiveCartCount} digits={digits} />
            </span>
            <span className="text-[11px] font-semibold leading-none">{s.cartLabel}</span>
          </button>
        </div>
      </header>
    </>
  );
}
