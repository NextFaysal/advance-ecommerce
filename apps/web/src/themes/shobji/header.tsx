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
 * Deliberate absences (honesty rules): there is NO location
 * selector and NO language toggle — the platform has neither a
 * per-visitor location nor a header-level locale switch, and a
 * control that pretends otherwise would be a lie. No announcement
 * bar either; the layout's signature is the persistent category
 * sidebar (home-sections.tsx / shop-chrome.tsx), not the header.
 *
 * Counts mirror SiteHeader's data path exactly: guest cart from
 * localStorage (@/cart/persistence + @/cart/types), wishlist from
 * @/catalog/wishlist, refreshed on storage/focus and on the cart's
 * CART_UPDATED_EVENT. SSR renders no badges (values load after
 * mount), avoiding hydration mismatch — same discipline as
 * SiteHeader.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { WISHLIST_CHANGE_EVENT, getWishlistIds } from "@/catalog/wishlist";
import { GUEST_CART_KEY, loadGuestCart } from "@/cart/persistence";
import { cartItemCount } from "@/cart/types";
import { CART_UPDATED_EVENT } from "@/cart/components/AddToCartButton";
import { Icon } from "@/components/ui/icon";
import { useThemeView } from "../theme-view";
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
}: ThemeHeaderProps) {
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
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:flex-nowrap">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2"
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
              placeholder="পণ্য খুঁজুন… যেমন: টাটকা সবজি, ফল, মাছ, মাংস"
              aria-label="পণ্য খুঁজুন"
              className="h-11 w-full rounded-full border border-input bg-muted pl-4 pr-12 text-sm text-text-main shadow-sm transition placeholder:text-text-subtle focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            <button
              type="submit"
              aria-label="খুঁজুন"
              className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white transition hover:opacity-90"
            >
              <Icon name="search" size={18} />
            </button>
          </div>
        </form>

        {/* Actions — Track/Wishlist icon links, solid purple
            account button, cart icon button (opens the drawer). */}
        <div className="order-2 ml-auto flex shrink-0 items-center gap-1 sm:gap-2 lg:order-3 lg:ml-0">
          <Link
            href="/track"
            className="relative hidden min-w-[52px] flex-col items-center gap-0.5 rounded-md px-1.5 py-1 text-text-muted transition hover:text-primary min-[420px]:flex"
          >
            <Icon name="package" size={23} />
            <span className="text-[11px] font-medium leading-none">Track Order</span>
          </Link>
          <Link
            href="/wishlist"
            className="relative flex min-w-[52px] flex-col items-center gap-0.5 rounded-md px-1.5 py-1 text-text-muted transition hover:text-primary"
          >
            <span className="relative">
              <Icon name="heart" size={23} />
              <PurpleBadge count={wishlistCount} />
            </span>
            <span className="text-[11px] font-medium leading-none">Wishlist</span>
          </Link>
          <Link
            href="/account"
            className="ml-1 flex h-10 items-center gap-2 rounded-full px-4 text-sm font-bold text-white shadow-sm transition hover:opacity-90"
            style={{ backgroundColor: SHOBJI_COLORS.primary }}
          >
            <Icon name="user" size={17} />
            লগইন
          </Link>
          <button
            type="button"
            onClick={openCartDrawer}
            aria-label={`কার্ট${effectiveCartCount > 0 ? `, ${effectiveCartCount}টি পণ্য` : ""} — ড্রয়ার খুলুন`}
            className="relative flex min-w-[52px] flex-col items-center gap-0.5 rounded-md px-1.5 py-1 text-text-muted transition hover:text-primary"
          >
            <span className="relative">
              <Icon name="cart" size={23} />
              <PurpleBadge count={effectiveCartCount} />
            </span>
            <span className="text-[11px] font-medium leading-none">Cart</span>
          </button>
        </div>
      </div>

      {/* Mobile category strip — the sidebar's content on small
          screens (CSS-only collapse of the same real links). The
          desktop sidebar lives in HomeSections / ShopChrome. */}
      {showSidebar && roots.length > 0 ? (
        <nav aria-label="ক্যাটাগরি" className="border-t border-border lg:hidden">
          <div className="scrollbar-none flex items-center gap-1 overflow-x-auto px-4 py-1.5 sm:px-6">
            <Link
              href="/shop"
              className="shrink-0 whitespace-nowrap rounded-full bg-secondary px-3 py-1.5 text-[13px] font-bold text-secondary-foreground"
            >
              সব পণ্য
            </Link>
            {roots.map((c) => (
              <Link
                key={c.slug}
                href={`/shop?category=${c.slug}`}
                className="shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium text-text-muted transition hover:bg-muted hover:text-text-main"
              >
                {c.name.bn}
              </Link>
            ))}
          </div>
        </nav>
      ) : null}
    </header>

    {/* Floating purple cart tab — right edge, real count +
        subtotal, opens the drawer (gated by showFloatingCart). */}
    <ShobjiFloatingCart />
    </>
  );
}
