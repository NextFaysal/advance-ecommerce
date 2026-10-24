"use client";

// SiteHeader — shared storefront header (Agent 31, Storefront Shell).
//
// Client component: wishlist/cart counts live in localStorage, so they are
// read after mount (SSR renders no badges, avoiding hydration mismatch) and
// refreshed on window `storage` events + focus.
// - Wishlist count: getWishlistIds() from "@/catalog/wishlist".
// - Cart count: a readable helper EXISTS — loadGuestCart() +
//   cartItemCount() from "@/cart". The optional `cartCount` prop overrides
//   the localStorage value (e.g. once a server cart is wired); omit it to
//   use the guest-cart value. Badge hides itself when the count is 0.
//   The cart button links to /cart (page added by Agent 33).
// Brand name is a prop (default "Advance Ecommerce") because each client
// install is white-labelled via settings. Design tokens only.

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getWishlistIds } from "@/catalog/wishlist";
import { GUEST_CART_KEY, loadGuestCart } from "@/cart/persistence";
import { cartItemCount } from "@/cart/types";
import { CART_UPDATED_EVENT } from "@/cart/components/AddToCartButton";

export interface SiteHeaderProps {
  brandName?: string;
  /** Overrides the guest-cart localStorage count when provided. */
  cartCount?: number;
}

const NAV_LINKS = [
  { href: "/shop", labelBn: "দোকান", labelEn: "Shop" },
  { href: "/track", labelBn: "অর্ডার ট্র্যাক", labelEn: "Track Order" },
  { href: "/faq", labelBn: "জিজ্ঞাসা", labelEn: "FAQ" },
  { href: "/contact", labelBn: "যোগাযোগ", labelEn: "Contact" },
] as const;

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-bold text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

const iconProps = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function HeartIcon() {
  return (
    <svg {...iconProps}>
      <path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 1 1 12 6.1a5 5 0 1 1 7.5 6.5Z" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="17" cy="20" r="1.4" />
      <path d="M2 3h3l2.6 12.4a1.5 1.5 0 0 0 1.5 1.1h7.9a1.5 1.5 0 0 0 1.5-1.2L20.5 7H6" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-3.6 4.5-5 8-5s6.5 1.4 8 5" />
    </svg>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg {...iconProps}>
      {open ? <path d="M5 5l14 14M19 5L5 19" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
    </svg>
  );
}

export default function SiteHeader({ brandName = "Advance Ecommerce", cartCount }: SiteHeaderProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [wishlistCount, setWishlistCount] = useState(0);
  const [localCartCount, setLocalCartCount] = useState(0);

  useEffect(() => {
    const refresh = () => {
      setWishlistCount(getWishlistIds().length);
      const guest = loadGuestCart();
      setLocalCartCount(guest ? cartItemCount(guest) : 0);
    };
    refresh();
    // Same-tab writes do not fire `storage`; focus covers the common case
    // (add on a page, come back) without a custom event bus.
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === GUEST_CART_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    // Same-tab add-to-cart writes dispatch this event (storage does not
    // fire in the tab that wrote), so the count updates instantly.
    window.addEventListener(CART_UPDATED_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(CART_UPDATED_EVENT, refresh);
    };
  }, []);

  const effectiveCartCount = cartCount ?? localCartCount;
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : (pathname?.startsWith(href) ?? false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-4 sm:gap-4 sm:px-6">
        {/* Brand */}
        <a href="/" className="flex shrink-0 items-center gap-2" aria-label={brandName}>
          <span className="brand-gradient flex h-9 w-9 items-center justify-center rounded-md text-base font-bold text-white">
            {brandName.charAt(0)}
          </span>
          <span className="hidden text-base font-bold text-text-main min-[420px]:block">
            {brandName}
          </span>
        </a>

        {/* Search — plain GET form to the existing /search route */}
        <form action="/search" method="get" role="search" className="min-w-0 flex-1 sm:max-w-md">
          <label className="sr-only" htmlFor="site-search">
            পণ্য খুঁজুন
          </label>
          <input
            id="site-search"
            name="q"
            type="search"
            placeholder="পণ্য খুঁজুন…"
            className="h-10 w-full rounded-[10px] border border-border bg-surface-2 px-3 text-sm text-text-main outline-none focus:border-brand-500"
          />
        </form>

        {/* Desktop nav */}
        <nav aria-label="প্রধান নেভিগেশন" className="ml-2 hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={`rounded-md px-3 py-2 text-sm ${
                isActive(link.href)
                  ? "font-semibold text-brand-700"
                  : "text-text-muted hover:bg-surface-2 hover:text-text-main"
              }`}
            >
              {link.labelBn}
            </a>
          ))}
        </nav>

        <span className="ml-auto flex items-center gap-1 lg:ml-0">
          <a
            href="/account"
            aria-label="অ্যাকাউন্ট"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text-main"
          >
            <UserIcon />
          </a>
          <a
            href="/wishlist"
            aria-label={`উইশলিস্ট${wishlistCount > 0 ? `, ${wishlistCount}টি পণ্য` : ""}`}
            className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text-main"
          >
            <HeartIcon />
            <CountBadge count={wishlistCount} />
          </a>
          <a
            href="/cart"
            aria-label={`কার্ট${effectiveCartCount > 0 ? `, ${effectiveCartCount}টি পণ্য` : ""}`}
            className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text-main"
          >
            <CartIcon />
            <CountBadge count={effectiveCartCount} />
          </a>
          <button
            type="button"
            aria-label={menuOpen ? "মেনু বন্ধ করুন" : "মেনু খুলুন"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-text-muted hover:bg-surface-2 lg:hidden"
          >
            <MenuIcon open={menuOpen} />
          </button>
        </span>
      </div>

      {/* Mobile menu — simple disclosure */}
      {menuOpen ? (
        <nav aria-label="মোবাইল নেভিগেশন" className="border-t border-border bg-card px-4 py-2 lg:hidden">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={`block rounded-md px-3 py-2 text-sm ${
                isActive(link.href) ? "font-semibold text-brand-700" : "text-text-main hover:bg-surface-2"
              }`}
            >
              {link.labelBn}
              <span className="ml-2 text-xs text-text-subtle">{link.labelEn}</span>
            </a>
          ))}
          <a href="/account" className="block rounded-md px-3 py-2 text-sm text-text-main hover:bg-surface-2">
            অ্যাকাউন্ট<span className="ml-2 text-xs text-text-subtle">Account</span>
          </a>
          <a href="/wishlist" className="block rounded-md px-3 py-2 text-sm text-text-main hover:bg-surface-2">
            উইশলিস্ট<span className="ml-2 text-xs text-text-subtle">Wishlist</span>
          </a>
        </nav>
      ) : null}
    </header>
  );
}
