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
//
// Design v3 (A+ Aurora Premium):
// - The sticky header turns `.glass` once the page is scrolled (>8px);
//   at the very top it stays a solid card surface.
// - ThemeToggle (dark mode) sits with the account/wishlist/cart icons.
// - The cart badge pops (`.animate-badge-pop`, re-keyed by count).
// - Mega menu: the shell passes `categories` (public categories API);
//   desktop gets a "সব ক্যাটাগরি" panel of tinted tiles, mobile gets a
//   category section inside the menu. The desktop row renders ALWAYS
//   (v3 QA fix): while the fetch is in flight (`categories` undefined)
//   the panel shows a loading shimmer instead of the row popping in
//   late and shifting the layout.
// - Search: desktop dropdown panel + mobile full-screen overlay with
//   trending terms and live suggestions from the EXISTING public
//   products API (GET /api/v1/public/products?q=). Submitting still
//   goes to /search?q= exactly as before.

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatBdt } from "@advance-ecommerce/validators";
import { WISHLIST_CHANGE_EVENT, getWishlistIds } from "@/catalog/wishlist";
import { GUEST_CART_KEY, loadGuestCart } from "@/cart/persistence";
import { cartItemCount } from "@/cart/types";
import { CART_UPDATED_EVENT } from "@/cart/components/AddToCartButton";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { NumeralsToggle, useDigitText } from "@/components/ui/numerals";
import type { Category, PublicProduct } from "@/catalog/types";
import { minVariantPricePoisha } from "@/catalog/types";

export interface SiteHeaderProps {
  brandName?: string;
  /** Overrides the guest-cart localStorage count when provided. */
  cartCount?: number;
  /** Public categories for the mega menu; `undefined` while the shell's
      fetch is still in flight (the row renders, the panel shows a
      loading state). An empty array means no categories exist. */
  categories?: ReadonlyArray<Category>;
}

const NAV_LINKS = [
  { href: "/shop", labelBn: "দোকান" },
  { href: "/track", labelBn: "অর্ডার ট্র্যাক" },
  { href: "/faq", labelBn: "জিজ্ঞাসা" },
  { href: "/contact", labelBn: "যোগাযোগ" },
] as const;

// Sensible BD storefront trending terms (static copy, not fake data —
// they are just search shortcuts into the real /search route).
const TRENDING_TERMS = [
  "শাড়ি",
  "পাঞ্জাবি",
  "থ্রি-পিস",
  "স্মার্টওয়াচ",
  "ওয়্যারলেস ইয়ারবাডস",
  "জুতা",
  "হাতঘড়ি",
  "ব্যাগ",
] as const;

function CountBadge({ count, pop = false }: { count: number; pop?: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      // Re-keying by the count remounts the span, replaying the pop.
      key={pop ? count : undefined}
      className={`absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-bold text-white ${
        pop ? "animate-badge-pop" : ""
      }`}
    >
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

function GridIcon() {
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
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5 5l14 14M19 5L5 19" />
    </svg>
  );
}

/** Shared body of the desktop search panel + mobile search overlay. */
function SearchPanelContent({
  query,
  searching,
  suggestions,
  onNavigate,
}: {
  query: string;
  searching: boolean;
  suggestions: ReadonlyArray<PublicProduct>;
  onNavigate: () => void;
}): ReactNode {
  const digits = useDigitText();
  const q = query.trim();
  if (q.length < 2) {
    return (
      <div>
        <p className="px-2 text-xs font-bold text-text-subtle">জনপ্রিয় খোঁজ</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {TRENDING_TERMS.map((term) => (
            <Link
              key={term}
              href={`/search?q=${encodeURIComponent(term)}`}
              onClick={onNavigate}
              className="inline-flex min-h-[44px] items-center rounded-full border border-border bg-surface-2 px-4 text-sm font-medium text-text-main transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
            >
              {term}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {searching && suggestions.length === 0 ? (
        <p className="px-2 py-3 text-sm text-text-muted">খুঁজছি…</p>
      ) : suggestions.length > 0 ? (
        <ul>
          {suggestions.map((p) => {
            const thumb = p.images[0]?.url ?? p.variants.find((v) => v.imageUrl)?.imageUrl ?? null;
            return (
              <li key={p.id}>
                <Link
                  href={`/product/${p.slug}`}
                  onClick={onNavigate}
                  className="flex min-h-[44px] items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-surface-2"
                >
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" loading="lazy" />
                  ) : (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-brand-300">
                      <ShopIcon />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text-main">{p.title.bn}</span>
                    {p.brandName ? (
                      <span className="block truncate text-xs text-text-subtle">{p.brandName}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-brand-700">
                    {digits(formatBdt(minVariantPricePoisha(p)))}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="break-words px-2 py-3 text-sm text-text-muted [overflow-wrap:anywhere]">
          “{q}” দিয়ে কোনো পণ্য পাওয়া যায়নি
        </p>
      )}
      <Link
        href={`/search?q=${encodeURIComponent(q)}`}
        onClick={onNavigate}
        className="mt-1 flex min-h-[44px] items-center rounded-xl px-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
      >
        সব ফলাফল দেখুন →
      </Link>
    </div>
  );
}

export default function SiteHeader({ brandName = "Advance Ecommerce", cartCount, categories }: SiteHeaderProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [wishlistCount, setWishlistCount] = useState(0);
  const [localCartCount, setLocalCartCount] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const [megaOpen, setMegaOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<ReadonlyArray<PublicProduct>>([]);
  const [searching, setSearching] = useState(false);

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
    // Same story for wishlist toggles (card / PDP / wishlist page).
    window.addEventListener(WISHLIST_CHANGE_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(CART_UPDATED_EVENT, refresh);
      window.removeEventListener(WISHLIST_CHANGE_EVENT, refresh);
    };
  }, []);

  // Glass header once scrolled past a few pixels; solid at the top.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Panels/menus never survive a navigation.
  useEffect(() => {
    setMenuOpen(false);
    setMegaOpen(false);
    setSearchOpen(false);
    setMobileSearchOpen(false);
  }, [pathname]);

  // Live search suggestions — debounced, aborted on change; the public
  // products API is the same search the /search page is built on.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/v1/public/products?q=${encodeURIComponent(q)}&pageSize=6`, { signal: ctrl.signal })
        .then((res) => (res.ok ? res.json() : null))
        .then((json: { data?: unknown } | null) => {
          setSuggestions(json && Array.isArray(json.data) ? (json.data as PublicProduct[]) : []);
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setSuggestions([]);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setSearching(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  const effectiveCartCount = cartCount ?? localCartCount;
  const hasCategories = Boolean(categories && categories.length > 0);
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

      <header
        className={`sticky top-0 z-40 transition-shadow duration-200 ${
          scrolled ? "glass" : "border-b border-border bg-card shadow-sm"
        }`}
      >
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

          {/* Search — GET form to the existing /search route, upgraded
              with a suggestions panel (desktop) / overlay (mobile) */}
          <div
            className="relative min-w-0 flex-1 sm:max-w-xl"
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSearchOpen(false);
            }}
          >
            {/* Mobile trigger — opens the full-screen search overlay */}
            <button
              type="button"
              onClick={() => setMobileSearchOpen(true)}
              aria-label="পণ্য খুঁজুন"
              className="flex h-11 w-full items-center gap-2 rounded-full border border-border bg-surface-2 pl-4 pr-1.5 text-sm text-text-subtle sm:hidden"
            >
              <span className="min-w-0 flex-1 truncate text-left">পণ্য খুঁজুন…</span>
              <span className="brand-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white">
                <SearchIcon />
              </span>
            </button>

            {/* Desktop form + dropdown panel */}
            <form
              action="/search"
              method="get"
              role="search"
              className="relative hidden sm:block"
              onSubmit={() => setSearchOpen(false)}
            >
              <label className="sr-only" htmlFor="site-search">
                পণ্য খুঁজুন
              </label>
              <div className="relative">
                <input
                  id="site-search"
                  name="q"
                  type="search"
                  autoComplete="off"
                  placeholder="পণ্য খুঁজুন…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onFocus={() => setSearchOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setSearchOpen(false);
                  }}
                  className="h-11 w-full rounded-full border border-border bg-surface-2 pl-4 pr-12 text-sm text-text-main outline-none transition focus:border-brand-500 focus:bg-surface"
                />
                <button
                  type="submit"
                  aria-label="খুঁজুন"
                  className="brand-gradient absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-full text-white transition hover:opacity-90"
                >
                  <SearchIcon />
                </button>
              </div>

              {searchOpen ? (
                <div className="absolute inset-x-0 top-[calc(100%+10px)] z-40 max-h-[min(70vh,540px)] overflow-y-auto rounded-2xl border border-border bg-card p-3 shadow-pop">
                  <SearchPanelContent
                    query={query}
                    searching={searching}
                    suggestions={suggestions}
                    onNavigate={() => setSearchOpen(false)}
                  />
                </div>
              ) : null}
            </form>
          </div>

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
            <NumeralsToggle />
            <ThemeToggle />
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
              <CountBadge count={effectiveCartCount} pop />
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

        {/* Mega menu row — desktop only. Rendered ALWAYS (v3 QA fix):
            the categories fetch can take seconds on a cold start, and
            gating the whole row on it made the row pop in late with a
            layout shift. The panel below handles the loading state. */}
        <div
          className="relative mx-auto hidden max-w-[1440px] px-4 sm:px-6 lg:block"
          onMouseLeave={() => setMegaOpen(false)}
        >
            <div className="flex items-center gap-2 border-t border-border/60 py-1.5">
              <button
                type="button"
                aria-expanded={megaOpen}
                aria-haspopup="true"
                onMouseEnter={() => setMegaOpen(true)}
                onClick={() => setMegaOpen((v) => !v)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setMegaOpen(false);
                }}
                className="brand-gradient flex min-h-[44px] items-center gap-2 rounded-lg px-4 text-sm font-bold text-white shadow-sm transition hover:opacity-90"
              >
                <GridIcon />
                সব ক্যাটাগরি
                <ChevronDownIcon />
              </button>
              <a href="/shop" className="rounded-lg px-3 py-2 text-sm font-medium text-text-muted transition hover:text-brand-700">
                সব পণ্য
              </a>
              <a href="/track" className="rounded-lg px-3 py-2 text-sm font-medium text-text-muted transition hover:text-brand-700">
                অর্ডার ট্র্যাক
              </a>
            </div>

            {megaOpen ? (
              <div className="absolute inset-x-4 top-full z-40 sm:inset-x-6" onMouseEnter={() => setMegaOpen(true)}>
                {categories === undefined ? (
                  /* Fetch still in flight — shimmer tiles in the same
                     grid so the panel opens at its final size. */
                  <div
                    role="status"
                    className="grid grid-cols-3 gap-3 rounded-2xl border border-border bg-card p-4 shadow-pop xl:grid-cols-4"
                  >
                    <span className="sr-only">ক্যাটাগরি লোড হচ্ছে…</span>
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} aria-hidden="true" className="flex items-center gap-3 rounded-xl bg-surface-2 p-3">
                        <span className="skeleton-shimmer h-11 w-11 shrink-0 rounded-lg" />
                        <span className="min-w-0 flex-1">
                          <span className="skeleton-shimmer block h-3.5 w-3/4 rounded" />
                          <span className="skeleton-shimmer mt-2 block h-3 w-1/2 rounded" />
                        </span>
                      </div>
                    ))}
                  </div>
                ) : categories.length > 0 ? (
                <div className="grid grid-cols-3 gap-3 rounded-2xl border border-border bg-card p-4 shadow-pop xl:grid-cols-4">
                  {categories.map((c, i) => (
                    <a
                      key={c.slug}
                      href={`/shop?category=${c.slug}`}
                      onClick={() => setMegaOpen(false)}
                      className={`cat-tint-${(i % 8) + 1} flex items-center gap-3 rounded-xl p-3 transition duration-200 hover:-translate-y-0.5 hover:shadow-md`}
                    >
                      {c.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.imageUrl} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" loading="lazy" />
                      ) : (
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-surface/80 text-base font-extrabold text-text-main shadow-sm">
                          {c.name.bn.charAt(0)}
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold">{c.name.bn}</span>
                        <span className="block text-xs opacity-75">{c.productCount}টি পণ্য</span>
                      </span>
                    </a>
                  ))}
                </div>
                ) : (
                  /* Fetch resolved with no categories — the panel still
                     opens (the row is always present) with a quiet note
                     instead of a blank box. */
                  <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-pop">
                    <p className="text-sm text-text-muted">এখনো কোনো ক্যাটাগরি যোগ হয়নি</p>
                    <a
                      href="/shop"
                      onClick={() => setMegaOpen(false)}
                      className="mt-2 inline-block text-sm font-semibold text-brand-700 hover:underline"
                    >
                      সব পণ্য দেখুন →
                    </a>
                  </div>
                )}
              </div>
            ) : null}
        </div>

        {/* Mobile menu — simple disclosure (+ category section, v3) */}
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
            {categories === undefined ? (
              <div className="mt-1 border-t border-border pt-1">
                <p className="px-3 pb-1 pt-2.5 text-xs font-bold text-text-subtle">ক্যাটাগরি</p>
                <p role="status" className="px-3 py-2.5 text-sm text-text-muted">
                  লোড হচ্ছে…
                </p>
              </div>
            ) : hasCategories ? (
              <div className="mt-1 border-t border-border pt-1">
                <p className="px-3 pb-1 pt-2.5 text-xs font-bold text-text-subtle">ক্যাটাগরি</p>
                {categories.map((c) => (
                  <a
                    key={c.slug}
                    href={`/shop?category=${c.slug}`}
                    className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm text-text-main hover:bg-surface-2"
                  >
                    <span className="min-w-0 truncate">{c.name.bn}</span>
                    <span className="shrink-0 text-xs text-text-subtle">{c.productCount}টি পণ্য</span>
                  </a>
                ))}
              </div>
            ) : null}
          </nav>
        ) : null}
      </header>

      {/* Mobile search overlay — full-screen, same GET /search contract */}
      {mobileSearchOpen ? (
        <div role="dialog" aria-modal="true" aria-label="পণ্য খুঁজুন" className="fixed inset-0 z-50 flex flex-col bg-card sm:hidden">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <form
              action="/search"
              method="get"
              role="search"
              className="min-w-0 flex-1"
              onSubmit={() => setMobileSearchOpen(false)}
            >
              <label className="sr-only" htmlFor="site-search-mobile">
                পণ্য খুঁজুন
              </label>
              <div className="relative">
                <input
                  id="site-search-mobile"
                  name="q"
                  type="search"
                  autoComplete="off"
                  autoFocus
                  placeholder="পণ্য খুঁজুন…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setMobileSearchOpen(false);
                  }}
                  className="h-11 w-full rounded-full border border-border bg-surface-2 pl-4 pr-12 text-sm text-text-main outline-none transition focus:border-brand-500 focus:bg-surface"
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
            <button
              type="button"
              aria-label="বন্ধ করুন"
              onClick={() => setMobileSearchOpen(false)}
              className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-2 hover:text-text-main"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <SearchPanelContent
              query={query}
              searching={searching}
              suggestions={suggestions}
              onNavigate={() => setMobileSearchOpen(false)}
            />
          </div>
        </div>
      ) : null}

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
                    <CountBadge count={item.badge} pop={item.href === "/cart"} />
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
