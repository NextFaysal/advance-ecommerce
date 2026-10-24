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
// Design refresh (Direction A): gradient announcement bar (scrolls away),
// sticky polished header, icon-in-field search, and a mobile bottom nav
// (hidden on /product/* where the PDP sticky buy bar owns the bottom).

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
  { href: "/shop", labelBn: "দোকান" },
  { href: "/track", labelBn: "অর্ডার ট্র্যাক" },
  { href: "/faq", labelBn: "জিজ্ঞাসা" },
  { href: "/contact", labelBn: "যোগাযোগ" },
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

function HomeIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3.5 10.8 12 3.5l8.5 7.3" />
      <path d="M5.5 9.5V20a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9.5" />
    </svg>
  );
}

function ShopIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function PackageIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 3 4 6.8v10.4L12 21l8-3.8V6.8L12 3z" />
      <path d="M4 6.8 12 10.6 20 6.8" />
      <path d="M12 10.6V21" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.8-3.8" />
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
  // On product pages the PDP's own sticky buy bar owns the bottom edge —
  // the mobile bottom nav steps aside there.
  const showBottomNav = !(pathname?.startsWith("/product/") ?? false);

  const bottomNavItems = [
    { href: "/", label: "হোম", icon: <HomeIcon />, badge: 0 },
    { href: "/shop", label: "দোকান", icon: <ShopIcon />, badge: 0 },
    { href: "/cart", label: "কার্ট", icon: <CartIcon />, badge: effectiveCartCount },
    { href: "/track", label: "ট্র্যাক", icon: <PackageIcon />, badge: 0 },
    { href: "/account", label: "অ্যাকাউন্ট", icon: <UserIcon />, badge: 0 },
  ] as const;

  return (
    <>
      {/* Announcement bar — brand gradient, scrolls away (not sticky) */}
      <div className="brand-gradient text-white">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-4 py-2 text-xs sm:px-6">
          <p className="min-w-0 truncate font-medium">সারাদেশে ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা দিন</p>
          <span className="hidden shrink-0 items-center gap-4 sm:flex">
            <a href="/track" className="font-semibold hover:underline">
              অর্ডার ট্র্যাক করুন
            </a>
            <a href="/faq" className="font-semibold hover:underline">
              সাহায্য
            </a>
          </span>
        </div>
      </div>

      <header className="sticky top-0 z-40 border-b border-border bg-card/90 shadow-sm backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-4 sm:gap-4 sm:px-6">
          {/* Brand */}
          <a href="/" className="flex shrink-0 items-center gap-2" aria-label={brandName}>
            <span className="brand-gradient flex h-9 w-9 items-center justify-center rounded-lg text-base font-bold text-white shadow-sm">
              {brandName.charAt(0)}
            </span>
            <span className="hidden text-base font-bold text-text-main min-[420px]:block">
              {brandName}
            </span>
          </a>

          {/* Search — plain GET form to the existing /search route */}
          <form action="/search" method="get" role="search" className="min-w-0 flex-1 sm:max-w-xl">
            <label className="sr-only" htmlFor="site-search">
              পণ্য খুঁজুন
            </label>
            <div className="relative">
              <input
                id="site-search"
                name="q"
                type="search"
                placeholder="পণ্য খুঁজুন…"
                className="h-11 w-full rounded-full border border-border bg-surface-2 pl-4 pr-12 text-sm text-text-main outline-none transition focus:border-brand-500 focus:bg-white"
              />
              <button
                type="submit"
                aria-label="খুঁজুন"
                className="brand-gradient absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-full text-white transition hover:opacity-90"
              >
                <SearchIcon />
              </button>
            </div>
          </form>

          {/* Desktop nav */}
          <nav aria-label="প্রধান নেভিগেশন" className="ml-2 hidden items-center gap-1 lg:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                aria-current={isActive(link.href) ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-sm transition ${
                  isActive(link.href)
                    ? "bg-brand-50 font-semibold text-brand-700"
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
              className="hidden min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-main sm:flex"
            >
              <UserIcon />
            </a>
            <a
              href="/wishlist"
              aria-label={`উইশলিস্ট${wishlistCount > 0 ? `, ${wishlistCount}টি পণ্য` : ""}`}
              className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-main"
            >
              <HeartIcon />
              <CountBadge count={wishlistCount} />
            </a>
            <a
              href="/cart"
              aria-label={`কার্ট${effectiveCartCount > 0 ? `, ${effectiveCartCount}টি পণ্য` : ""}`}
              className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-main"
            >
              <CartIcon />
              <CountBadge count={effectiveCartCount} />
            </a>
            <button
              type="button"
              aria-label={menuOpen ? "মেনু বন্ধ করুন" : "মেনু খুলুন"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 lg:hidden"
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
                className={`block rounded-lg px-3 py-2.5 text-sm ${
                  isActive(link.href)
                    ? "bg-brand-50 font-semibold text-brand-700"
                    : "text-text-main hover:bg-surface-2"
                }`}
              >
                {link.labelBn}
              </a>
            ))}
            <a href="/account" className="block rounded-lg px-3 py-2.5 text-sm text-text-main hover:bg-surface-2">
              অ্যাকাউন্ট
            </a>
            <a href="/wishlist" className="block rounded-lg px-3 py-2.5 text-sm text-text-main hover:bg-surface-2">
              উইশলিস্ট
            </a>
          </nav>
        ) : null}
      </header>

      {/* Mobile bottom nav — hidden on product pages (PDP buy bar wins) */}
      {showBottomNav ? (
        <nav
          aria-label="মোবাইল দ্রুত নেভিগেশন"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 shadow-[0_-4px_16px_rgba(49,46,129,0.08)] backdrop-blur lg:hidden"
        >
          <div className="grid grid-cols-5">
            {bottomNavItems.map((item) => {
              const active = isActive(item.href);
              return (
                <a
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                    active ? "text-brand-700" : "text-text-muted"
                  }`}
                >
                  <span className="relative">
                    {item.icon}
                    <CountBadge count={item.badge} />
                  </span>
                  {item.label}
                </a>
              );
            })}
          </div>
        </nav>
      ) : null}
    </>
  );
}
