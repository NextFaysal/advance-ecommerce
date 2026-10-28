"use client";

/**
 * Shobji Header (doc 27 theme T-B) — ThemeHeaderProps.
 *
 * A single white tier: brand left; a wide rounded search in the
 * centre (plain GET form to /search?q= — the same contract
 * SiteHeader uses); actions on the right — Track Order and
 * Wishlist as icon+label links, the account as a SOLID PURPLE
 * button, and the cart as an icon button whose click OPENS this
 * package's cart drawer (cart-drawer-events) instead of linking to
 * /cart. The /cart page still exists for deep links.
 *
 * Deliberate absence (honesty rules): there is NO location
 * selector — the platform has no per-visitor location, and a
 * control that pretends otherwise would be a lie. The language
 * switcher in the actions row IS real: it is the platform's
 * unified LanguageSwitcher (doc 30), which persists the visitor's
 * choice and re-renders the whole store in that language. No
 * announcement bar either; the layout's signature is the
 * persistent category sidebar (home-sections.tsx /
 * shop-chrome.tsx), not the header.
 *
 * Counts mirror SiteHeader's data path exactly: guest cart from
 * localStorage (@/cart/persistence + @/cart/types), wishlist from
 * @/catalog/wishlist, refreshed on storage/focus and on the cart's
 * CART_UPDATED_EVENT. SSR renders no badges (values load after
 * mount), avoiding hydration mismatch — same discipline as
 * SiteHeader.
 *
 * Doc 33 R2 — phone collapse (§4): only the white main tier
 * carries `sticky` (sibling structure, so its containing block is
 * the page); stuck height ≈ 112px (py-2 + actions row + search
 * row). The sidebar's phone answer is the category CHIP RAIL
 * under the tier — the pre-33 strip, formalised: 44px chips,
 * 14px labels, rail-fade affordance; it scrolls away with the
 * page (the /shop rail that stays in context is R5's). The
 * desktop category sidebar (lg+) is untouched. A hamburger in
 * the main tier opens the shared MobileMenuDrawer (§3.3), fed by
 * the same `headerMenu` / `categories` props.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { WISHLIST_CHANGE_EVENT, getWishlistIds } from "@/catalog/wishlist";
import { GUEST_CART_KEY, loadGuestCart } from "@/cart/persistence";
import { cartItemCount } from "@/cart/types";
import { CART_UPDATED_EVENT } from "@/cart/components/AddToCartButton";
import { Icon } from "@/components/ui/icon";
import { useThemeView } from "../theme-view";
import { LanguageSwitcher } from "@/i18n/LanguageSwitcher";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { SHOBJI_STRINGS } from "./strings";
import { MobileMenuDrawer } from "@/storefront-ux/components/MobileMenuDrawer";
import { RAIL_FADE_CLASS } from "@/storefront-ux/responsive";
import { openCartDrawer } from "../cart-drawer-events";
import ShobjiFloatingCart from "./floating-cart";
import { SHOBJI_COLORS } from "./tokens";
import type { ThemeHeaderProps } from "../slots";

function PurpleBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold text-accent-foreground shadow-sm">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export default function ShobjiHeader({
  brandName = "Advance Ecommerce",
  cartCount,
  categories,
  headerMenu,
}: ThemeHeaderProps) {
  const { locale } = useLocale();
  const s = pick(locale, SHOBJI_STRINGS);
  const themeView = useThemeView();
  const showSidebar = themeView.options.showSidebar !== false;

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
  const roots = categories ?? [];

  return (
    <>
    <header className="sticky top-0 z-40 border-b border-border bg-card shadow-card">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6 lg:flex-nowrap lg:py-3">
        {/* Mobile menu (doc 33 §3.3) — the shared drawer; the
            switcher rides in its footer slot AND stays in the
            actions row below (every-width rule). */}
        <MobileMenuDrawer
          brandName={brandName}
          headerMenu={headerMenu}
          categories={categories}
          footer={<LanguageSwitcher />}
          triggerClassName="-ml-1.5 shrink-0"
        />

        <Link
          href="/"
          className="flex min-h-[44px] shrink-0 items-center gap-2"
          aria-label={brandName}
        >
          <span className="brand-gradient flex h-10 w-10 items-center justify-center rounded-md text-lg font-bold text-white">
            {brandName.charAt(0)}
          </span>
          <span className="max-w-[10rem] truncate text-lg font-bold leading-tight text-text-main sm:max-w-none">
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
              placeholder={s.searchPlaceholderLong}
              aria-label={s.searchProductsAria}
              className="h-11 w-full rounded-full border border-input bg-muted pl-4 pr-12 text-sm text-text-main shadow-sm transition placeholder:text-text-subtle focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            <button
              type="submit"
              aria-label={s.searchSubmitAria}
              className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-white transition hover:opacity-90"
            >
              <Icon name="search" size={18} />
            </button>
          </div>
        </form>

        {/* Actions — language switcher first (always visible at
            every width in this row), then Track/Wishlist icon links,
            solid purple account button, cart icon button (opens the
            drawer). */}
        <div className="order-2 ml-auto flex shrink-0 items-center gap-1 sm:gap-2 lg:order-3 lg:ml-0">
          <LanguageSwitcher className="mr-1" />
          <Link
            href="/track"
            className="relative hidden min-h-[44px] min-w-[52px] flex-col items-center justify-center gap-0.5 rounded-md px-1.5 py-1 text-text-muted transition hover:text-primary xs:flex"
          >
            <Icon name="package" size={23} />
            <span className="text-[11px] font-medium leading-none">{s.trackOrder}</span>
          </Link>
          <Link
            href="/wishlist"
            className="relative flex min-h-[44px] min-w-[52px] flex-col items-center justify-center gap-0.5 rounded-md px-1.5 py-1 text-text-muted transition hover:text-primary"
          >
            <span className="relative">
              <Icon name="heart" size={23} />
              <PurpleBadge count={wishlistCount} />
            </span>
            <span className="text-[11px] font-medium leading-none">{s.wishlist}</span>
          </Link>
          <Link
            href="/account"
            className="ml-1 flex h-11 items-center gap-2 rounded-full px-4 text-sm font-bold text-white shadow-sm transition hover:opacity-90"
            style={{ backgroundColor: SHOBJI_COLORS.primary }}
          >
            <Icon name="user" size={17} />
            {s.login}
          </Link>
          <button
            type="button"
            onClick={openCartDrawer}
            aria-label={effectiveCartCount > 0 ? interpolate(s.cartDrawerAriaWithCount, { count: effectiveCartCount }) : s.cartDrawerAria}
            className="relative flex min-h-[44px] min-w-[52px] flex-col items-center justify-center gap-0.5 rounded-md px-1.5 py-1 text-text-muted transition hover:text-primary"
          >
            <span className="relative">
              <Icon name="cart" size={23} />
              <PurpleBadge count={effectiveCartCount} />
            </span>
            <span className="text-[11px] font-medium leading-none">{s.cart}</span>
          </button>
        </div>
      </div>
    </header>

    {/* Category chip rail — the sidebar's phone answer (doc 33
        §4): the same real category links as the desktop rail,
        formalised to the contract — 44px chips, 14px labels, the
        shared rail fade where the row scrolls. It is a sibling
        AFTER the sticky header, so it scrolls away with the page
        (only the main tier sticks); the /shop-context rail is
        R5's. The desktop sidebar lives in HomeSections /
        ShopChrome and is untouched. */}
    {showSidebar && roots.length > 0 ? (
      <nav aria-label={s.categories} className="border-b border-border bg-card lg:hidden">
        <div className={`scrollbar-none flex items-center gap-1.5 overflow-x-auto px-4 py-1 sm:px-6 ${RAIL_FADE_CLASS}`}>
          <Link
            href="/shop"
            className="flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-full bg-secondary px-3.5 text-sm font-bold text-secondary-foreground"
          >
            {s.allProducts}
          </Link>
          {roots.map((c) => (
            <Link
              key={c.slug}
              href={`/shop?category=${c.slug}`}
              className="flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-sm font-medium text-text-muted transition hover:bg-muted hover:text-text-main"
            >
              {c.name[locale] || c.name.bn}
            </Link>
          ))}
        </div>
      </nav>
    ) : null}

    {/* Floating purple cart tab — right edge, real count +
        subtotal, opens the drawer (gated by showFloatingCart). */}
    <ShobjiFloatingCart />
    </>
  );
}
