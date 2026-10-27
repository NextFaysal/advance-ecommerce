"use client";

/**
 * Bazaar Header (doc 24 wave T1 / doc 25 wave S4a) — ThemeHeaderProps.
 *
 * Two tiers, grocery-store layout:
 * - Tier 1 (white): brand left; a wide, soft-rounded search in the
 *   centre (plain GET form to /search?q= — the same contract
 *   SiteHeader uses); icon+label actions on the right — Track Order
 *   (/track), Account (/account), Wishlist (/wishlist, count badge),
 *   Cart (count badge in the primary orange).
 * - Tier 2: a full-width deep-green bar with the category row
 *   (roots from the `categories` prop, each linking
 *   /shop?category=<slug>, plus the header menu links) — sticky
 *   with the header, horizontally scrollable on mobile.
 *
 * Behaviour differences from Aurora are the package's point:
 * - The cart action OPENS the cart drawer (cart-drawer-events)
 *   instead of linking to /cart — this package owns a drawer
 *   (S4b). The /cart page still exists for deep links.
 * - Floating elements (doc 24 T1): a right-edge cart tab (item
 *   count + subtotal, opens the drawer) and circular call/chat
 *   buttons — both gated by the package's merchant options
 *   (showFloatingCart / showSupportButtons). A back-to-top button
 *   appears after scrolling.
 * - No announcement bar and no dark-mode toggle in the header: the
 *   reference layout has neither, and this package is light-first
 *   (supportsDark: false).
 *
 * Counts mirror SiteHeader's data path exactly: guest cart from
 * localStorage (@/cart/persistence + @/cart/types), wishlist from
 * @/catalog/wishlist, refreshed on storage/focus and on the cart's
 * CART_UPDATED_EVENT so the floating tab stays live. SSR renders no
 * badges (values load after mount), avoiding hydration mismatch —
 * same discipline as SiteHeader.
 *
 * Support buttons: the header's props carry no store phone/WhatsApp
 * (no public setting exposes them to the shell), so both buttons
 * link to /contact — the page where the store's configured contact
 * channels live (the Aurora footer points there for the same
 * reason). No number is invented here.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBdt } from "@advance-ecommerce/validators";
import { WISHLIST_CHANGE_EVENT, getWishlistIds } from "@/catalog/wishlist";
import { GUEST_CART_KEY, loadGuestCart } from "@/cart/persistence";
import { cartItemCount, cartSubtotalPoisha } from "@/cart/types";
import { CART_UPDATED_EVENT } from "@/cart/components/AddToCartButton";
import { Icon } from "@/components/ui/icon";
import { useDigitText } from "@/components/ui/numerals";
import { DEFAULT_HEADER_MENU } from "@/cms/site-content-types";
import { LanguageSwitcher } from "@/i18n/LanguageSwitcher";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { useThemeView } from "../theme-view";
import { BAZAAR_STRINGS } from "./strings";
import { openCartDrawer } from "../cart-drawer-events";
import { BAZAAR_COLORS } from "./tokens";
import type { ThemeHeaderProps } from "../slots";

function OrangeBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-white shadow-sm">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export default function BazaarHeader({
  brandName = "Advance Ecommerce",
  cartCount,
  categories,
  headerMenu,
}: ThemeHeaderProps) {
  const digits = useDigitText();
  const { locale } = useLocale();
  const s = pick(locale, BAZAAR_STRINGS);
  const themeView = useThemeView();
  const showFloatingCart = themeView.options.showFloatingCart !== false;
  const showSupportButtons = themeView.options.showSupportButtons !== false;

  const [localCartCount, setLocalCartCount] = useState(0);
  const [cartTotalPoisha, setCartTotalPoisha] = useState(0);
  const [wishlistCount, setWishlistCount] = useState(0);
  const [scrolled, setScrolled] = useState(false);

  // Guest-cart + wishlist counts — SiteHeader's exact data path.
  useEffect(() => {
    function refresh() {
      const cart = loadGuestCart();
      setLocalCartCount(cart ? cartItemCount(cart) : 0);
      setCartTotalPoisha(cart ? cartSubtotalPoisha(cart) : 0);
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

  // Back-to-top visibility.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const effectiveCartCount = cartCount ?? localCartCount;
  const menu = headerMenu && headerMenu.length > 0 ? headerMenu : DEFAULT_HEADER_MENU;

  const actions: ReadonlyArray<{
    href: string;
    label: string;
    icon: "package" | "user" | "heart";
    badge?: number;
  }> = [
    { href: "/track", label: s.trackOrderAction, icon: "package" },
    { href: "/account", label: s.signInAction, icon: "user" },
    { href: "/wishlist", label: s.wishlistAction, icon: "heart", badge: wishlistCount },
  ];

  return (
    <>
      <header className="sticky top-0 z-40 shadow-card">
        {/* Tier 1 — white: brand, search, actions */}
        <div className="bg-card">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:flex-nowrap">
            <Link
              href="/"
              className="flex shrink-0 items-center gap-2"
              aria-label={brandName}
            >
              <span
                className="flex h-10 w-10 items-center justify-center rounded-md text-lg font-bold text-white"
                style={{ backgroundColor: BAZAAR_COLORS.navGreen }}
              >
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
                  className="h-11 w-full rounded-full border border-input bg-muted pl-4 pr-12 text-sm text-text-main shadow-sm transition placeholder:text-text-subtle focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
                <button
                  type="submit"
                  aria-label={s.searchButtonAria}
                  className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white transition hover:opacity-90"
                >
                  <Icon name="search" size={18} />
                </button>
              </div>
            </form>

            {/* Actions — icon + small label, like the reference tier.
                The language switcher leads the row: always visible at
                every width (this row never collapses into a menu). */}
            <div className="order-2 ml-auto flex shrink-0 items-start gap-1 sm:gap-2 lg:order-3 lg:ml-0">
              <LanguageSwitcher className="mr-1 self-center" />
              {actions.map((a) => (
                <Link
                  key={a.href}
                  href={a.href}
                  className="relative flex min-w-[52px] flex-col items-center gap-0.5 rounded-md px-1.5 py-1 text-text-muted transition hover:text-primary"
                >
                  <span className="relative">
                    <Icon name={a.icon} size={23} />
                    {a.badge !== undefined ? <OrangeBadge count={a.badge} /> : null}
                  </span>
                  <span className="text-[11px] font-medium leading-none">{a.label}</span>
                </Link>
              ))}
              <button
                type="button"
                onClick={openCartDrawer}
                aria-label={effectiveCartCount > 0 ? interpolate(s.cartDrawerAriaCount, { count: effectiveCartCount }) : s.cartDrawerAria}
                className="relative flex min-w-[52px] flex-col items-center gap-0.5 rounded-md px-1.5 py-1 text-text-muted transition hover:text-primary"
              >
                <span className="relative">
                  <Icon name="cart" size={23} />
                  <OrangeBadge count={effectiveCartCount} />
                </span>
                <span className="text-[11px] font-medium leading-none">{s.cartLabel}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Tier 2 — deep-green category bar */}
        <nav
          aria-label={s.categoriesAria}
          className="text-white"
          style={{ backgroundColor: BAZAAR_COLORS.navGreen }}
        >
          <div className="scrollbar-none mx-auto flex max-w-[1440px] items-center gap-1 overflow-x-auto px-4 sm:px-6">
            <Link
              href="/shop"
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm font-bold transition hover:bg-white/10"
            >
              <Icon name="grid" size={16} />
              {s.allCategories}
            </Link>
            {(categories ?? []).map((c) => (
              <Link
                key={c.slug}
                href={`/shop?category=${c.slug}`}
                className="shrink-0 whitespace-nowrap px-3 py-2.5 text-sm font-medium text-white/90 transition hover:bg-white/10 hover:text-white"
              >
                {c.name[locale] || c.name.bn}
              </Link>
            ))}
            <span aria-hidden="true" className="mx-1 hidden h-5 w-px shrink-0 bg-white/20 md:block" />
            {menu.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="hidden shrink-0 whitespace-nowrap px-3 py-2.5 text-sm font-medium text-white/90 transition hover:bg-white/10 hover:text-white md:block"
              >
                {locale === "bn" ? item.labelBn : item.labelEn || item.labelBn}
              </Link>
            ))}
          </div>
        </nav>
      </header>

      {/* Floating cart tab — right edge, count + total; opens the
          drawer. Rendered only when the merchant option is on and
          the cart is non-empty (an empty ৳0 tab is pure noise). */}
      {showFloatingCart && effectiveCartCount > 0 ? (
        <button
          type="button"
          onClick={openCartDrawer}
          aria-label={interpolate(s.floatingCartAria, { count: effectiveCartCount, total: formatBdt(cartTotalPoisha) })}
          className="fixed right-0 top-1/3 z-40 flex flex-col items-center gap-0.5 rounded-l-lg bg-primary px-2.5 py-3 text-white shadow-pop transition hover:opacity-95"
        >
          <Icon name="cart" size={20} />
          <span className="text-[11px] font-bold leading-tight">
            {digits(interpolate(s.itemCountShort, { count: effectiveCartCount }))}
          </span>
          <span className="text-[11px] font-semibold leading-tight">
            {digits(formatBdt(cartTotalPoisha))}
          </span>
        </button>
      ) : null}

      {/* Floating support buttons — call/chat; both route to
          /contact (see header comment: no public phone/WhatsApp
          setting reaches the header). */}
      {showSupportButtons ? (
        <div className="fixed bottom-24 right-3 z-40 flex flex-col gap-2 lg:bottom-6">
          <Link
            href="/contact"
            aria-label={s.chatContactAria}
            className="flex h-11 w-11 items-center justify-center rounded-full text-white shadow-pop transition hover:opacity-90"
            style={{ backgroundColor: BAZAAR_COLORS.whatsappGreen }}
          >
            <Icon name="info" size={20} />
          </Link>
          <Link
            href="/contact"
            aria-label={s.callOrderAria}
            className="flex h-11 w-11 items-center justify-center rounded-full text-white shadow-pop transition hover:opacity-90"
            style={{ backgroundColor: BAZAAR_COLORS.callNavy }}
          >
            <Icon name="phone" size={20} />
          </Link>
          {scrolled ? (
            <button
              type="button"
              aria-label={s.backToTopAria}
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-white shadow-pop transition hover:opacity-90"
            >
              <Icon name="chevron-down" size={20} className="rotate-180" />
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
