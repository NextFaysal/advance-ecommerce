"use client";

/**
 * Boighor Header (doc 27 T-C) — ThemeHeaderProps.
 *
 * FOUR tiers, books-catalogue layout:
 * - Tier 1 (blue utility bar): a left text slot and right links.
 *   The header props carry NO store phone (no public setting
 *   exposes one to the shell — SiteHeader hardcodes its own
 *   Aurora display string, which is not a data source), so the
 *   left slot carries our own generic delivery line instead of a
 *   number. Nothing is invented: the moment a public number prop
 *   exists on ThemeHeaderProps, this slot is where it goes. Right
 *   side: real links — Track Order (/track), Sign In (/account).
 * - Tier 2 (white): brand left; a very wide ROUNDED search in the
 *   centre (plain GET form to /search?q=, the platform contract)
 *   with a solid blue search button; account + cart buttons right.
 * - Tier 3 (white, hairline borders): the category row — roots
 *   from the `categories` prop, each linking /shop?category=<slug>,
 *   plus the CMS header menu links.
 * - Tier 4 (pale-blue facet row): quick links only — "সব বই"
 *   (/shop), sort shortcuts using ShopBrowser's real sort values
 *   (/shop?sort=newest, /shop?sort=price-asc, /shop?sort=rating)
 *   and the first categories again as quick jumps. PLAIN LINKS
 *   ONLY: no dropdown chrome that does not open. Gated by the
 *   package's `showFacetRow` merchant option.
 *
 * Behaviour: the cart button OPENS the package's cart drawer
 * (cart-drawer-events), like Bazaar's; /cart still exists for
 * deep links. Counts mirror SiteHeader's data path exactly: guest
 * cart from localStorage (@/cart/persistence + @/cart/types),
 * wishlist from @/catalog/wishlist, refreshed on storage/focus
 * and on the cart's CART_UPDATED_EVENT. SSR renders no badges
 * (values load after mount), avoiding hydration mismatch.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { WISHLIST_CHANGE_EVENT, getWishlistIds } from "@/catalog/wishlist";
import { GUEST_CART_KEY, loadGuestCart } from "@/cart/persistence";
import { cartItemCount } from "@/cart/types";
import { CART_UPDATED_EVENT } from "@/cart/components/AddToCartButton";
import { Icon } from "@/components/ui/icon";
import { DEFAULT_HEADER_MENU } from "@/cms/site-content-types";
import { useThemeView } from "../theme-view";
import { openCartDrawer } from "../cart-drawer-events";
import { BOIGHOR_COLORS } from "./tokens";
import { LanguageSwitcher } from "@/i18n/LanguageSwitcher";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { BOIGHOR_STRINGS, pickLocalized } from "./strings";
import type { ThemeHeaderProps } from "../slots";

function BlueBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-bold text-white shadow-sm">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export default function BoighorHeader({
  brandName = "Advance Ecommerce",
  cartCount,
  categories,
  headerMenu,
}: ThemeHeaderProps) {
  const themeView = useThemeView();
  const showFacetRow = themeView.options.showFacetRow !== false;

  const { locale } = useLocale();
  const s = pick(locale, BOIGHOR_STRINGS);
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
  const menu = headerMenu && headerMenu.length > 0 ? headerMenu : DEFAULT_HEADER_MENU;
  const cats = categories ?? [];
  const facetCats = cats.slice(0, 5);

  return (
    <header className="sticky top-0 z-40 shadow-card">
      {/* Tier 1 — blue utility bar: generic line left (no public
          phone prop exists — see header comment), real links right */}
      <div
        className="text-white"
        style={{ backgroundColor: BOIGHOR_COLORS.utilityBlue }}
      >
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-0.5 px-4 py-1.5 text-[13px] sm:px-6">
          <p className="flex items-center gap-1.5 font-medium">
            <Icon name="truck" size={15} />
            {s.deliveryLine}
          </p>
          <nav aria-label={s.quickLinksAria} className="ml-auto flex items-center gap-1">
            <Link
              href="/track"
              className="rounded px-2 py-1 font-medium text-white/90 transition hover:bg-white/10 hover:text-white"
            >
              {s.trackOrder}
            </Link>
            <span aria-hidden="true" className="h-4 w-px bg-white/25" />
            <Link
              href="/account"
              className="rounded px-2 py-1 font-medium text-white/90 transition hover:bg-white/10 hover:text-white"
            >
              {s.signIn}
            </Link>
          </nav>
        </div>
      </div>

      {/* Tier 2 — white: brand, very wide rounded search, actions */}
      <div className="bg-card">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:flex-nowrap">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2"
            aria-label={brandName}
          >
            <span className="brand-gradient flex h-10 w-10 items-center justify-center rounded-lg text-lg font-bold text-white shadow-sm">
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
                placeholder={s.searchPlaceholder}
                aria-label={s.searchAria}
                className="h-12 w-full rounded-full border border-input bg-card pl-5 pr-14 text-sm text-text-main shadow-sm transition placeholder:text-text-subtle focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
              />
              <button
                type="submit"
                aria-label={s.searchButtonAria}
                className="absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white transition hover:opacity-90"
              >
                <Icon name="search" size={18} />
              </button>
            </div>
          </form>

          {/* Actions — language switcher first (Tier 2 actions row
              is always visible at every width), then account,
              wishlist, cart */}
          <div className="order-2 ml-auto flex shrink-0 items-start gap-1 sm:gap-2 lg:order-3 lg:ml-0">
            <LanguageSwitcher className="mr-1 self-center" />
            <Link
              href="/account"
              className="relative flex min-w-[52px] flex-col items-center gap-0.5 rounded-lg px-1.5 py-1 text-text-muted transition hover:text-primary"
            >
              <Icon name="user" size={23} />
              <span className="text-[11px] font-medium leading-none">{s.account}</span>
            </Link>
            <Link
              href="/wishlist"
              className="relative flex min-w-[52px] flex-col items-center gap-0.5 rounded-lg px-1.5 py-1 text-text-muted transition hover:text-primary"
            >
              <span className="relative">
                <Icon name="heart" size={23} />
                <BlueBadge count={wishlistCount} />
              </span>
              <span className="text-[11px] font-medium leading-none">{s.wishlist}</span>
            </Link>
            <button
              type="button"
              onClick={openCartDrawer}
              aria-label={effectiveCartCount > 0 ? interpolate(s.cartAriaCount, { count: effectiveCartCount }) : s.cartAria}
              className="relative flex min-w-[52px] flex-col items-center gap-0.5 rounded-lg px-1.5 py-1 text-text-muted transition hover:text-primary"
            >
              <span className="relative">
                <Icon name="cart" size={23} />
                <BlueBadge count={effectiveCartCount} />
              </span>
              <span className="text-[11px] font-medium leading-none">{s.cart}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Tier 3 — category row (real categories + CMS menu) */}
      <nav aria-label={s.categoriesAria} className="border-t border-border bg-card">
        <div className="scrollbar-none mx-auto flex max-w-[1440px] items-center gap-1 overflow-x-auto px-4 sm:px-6">
          <Link
            href="/shop"
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm font-bold text-primary transition hover:bg-muted"
          >
            <Icon name="grid" size={16} />
            {s.allCategories}
          </Link>
          {cats.map((c) => (
            <Link
              key={c.slug}
              href={`/shop?category=${c.slug}`}
              className="shrink-0 whitespace-nowrap px-3 py-2.5 text-sm font-medium text-text-muted transition hover:bg-muted hover:text-primary"
            >
              {c.name.bn}
            </Link>
          ))}
          <span aria-hidden="true" className="mx-1 hidden h-5 w-px shrink-0 bg-border md:block" />
          {menu.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="hidden shrink-0 whitespace-nowrap px-3 py-2.5 text-sm font-medium text-text-muted transition hover:bg-muted hover:text-primary md:block"
            >
              {locale === "bn" ? item.labelBn : item.labelEn || item.labelBn}
            </Link>
          ))}
        </div>
      </nav>

      {/* Tier 4 — pale-blue facet row: PLAIN quick links only
          (real /shop hrefs; sort values are ShopBrowser's own URL
          contract). No dropdown chrome — every element here is a
          working link. Gated by the showFacetRow option. */}
      {showFacetRow ? (
        <nav
          aria-label={s.quickFiltersAria}
          className="border-t border-border"
          style={{ backgroundColor: BOIGHOR_COLORS.paleBlue }}
        >
          <div className="scrollbar-none mx-auto flex max-w-[1440px] items-center gap-1 overflow-x-auto px-4 py-1.5 sm:px-6">
            <span className="shrink-0 pr-1 text-[13px] font-bold text-text-main">
              {s.quickView}
            </span>
            <Link
              href="/shop"
              className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-medium text-primary transition hover:bg-white"
            >
              {s.allProducts}
            </Link>
            <Link
              href="/shop?sort=newest"
              className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-medium text-primary transition hover:bg-white"
            >
              {s.newestArrivals}
            </Link>
            <Link
              href="/shop?sort=price-asc"
              className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-medium text-primary transition hover:bg-white"
            >
              {s.lowestPriceFirst}
            </Link>
            <Link
              href="/shop?sort=rating"
              className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-medium text-primary transition hover:bg-white"
            >
              {s.highestRated}
            </Link>
            {facetCats.length > 0 ? (
              <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-primary/20" />
            ) : null}
            {facetCats.map((c) => (
              <Link
                key={c.slug}
                href={`/shop?category=${c.slug}`}
                className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-medium text-text-muted transition hover:bg-white hover:text-primary"
              >
                {c.name.bn}
              </Link>
            ))}
          </div>
        </nav>
      ) : null}
    </header>
  );
}
