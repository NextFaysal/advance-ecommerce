"use client";

/**
 * Neel ShopChrome slot — doc 27 T-E.
 *
 * The /shop (and category) composition in this package's
 * marketplace dress: a header row (big H1 left, breadcrumb
 * right) when a category is active, then a pale listing area —
 * a LEFT sidebar of stacked white cards and a white sort bar
 * over the results grid. ShopBrowser keeps ALL state, fetching,
 * URL parsing and href building; this chrome only arranges the
 * props it is handed (see ShopChromeProps in src/themes/slots.ts).
 *
 * Filter honesty — the sidebar presents ONLY the filter
 * dimensions ShopChromeProps actually carries, each wired to the
 * same href builders the platform uses (identical URLs,
 * identical behaviour):
 * - "FILTER BY CATEGORY": the category filter, checkbox-STYLED
 *   but with the platform's real single-select link semantics.
 * - "PRICE RANGE": the platform's preset price ranges (links).
 *   There is NO dual-handle slider: the existing price filter is
 *   preset ranges, and a slider that does not filter would be
 *   a lie.
 * - "BRANDS": the brand filter, checkbox-styled links.
 * - Attribute facets: the shop's real multi-select toggles.
 * - "RATING & AVAILABILITY": the rating floor + in-stock
 *   filters. Flags the platform cannot filter by are NOT shown.
 *
 * The per-page selector some marketplace layouts show is not
 * rendered: ShopChromeProps carries no page-size control, and
 * inventing one would break the URL contract ShopBrowser owns.
 * Pagination stays ShopBrowser's, inside `children`.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { useDigitText } from "@/components/ui/numerals";
import type { ShopChromeAttrPair, ShopChromeProps } from "../slots";
import { MobileFilterDrawer } from "../../../app/(store)/shop/MobileFilterDrawer";

/* Same preset ranges + sort options the platform's chrome
 * offers — ShopBrowser's URL contract values, unchanged. */
const PRICE_RANGES: ReadonlyArray<{ label: string; min?: number; max?: number }> = [
  { label: "৫০০ টাকার কম", max: 50000 },
  { label: "৫০০ – ১,০০০ টাকা", min: 50000, max: 100000 },
  { label: "১,০০০ – ৩,০০০ টাকা", min: 100000, max: 300000 },
  { label: "৩,০০০ টাকার বেশি", min: 300000 },
];

const SORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "relevance", label: "জনপ্রিয়তা" },
  { value: "newest", label: "নতুন আগে" },
  { value: "price-asc", label: "দাম: কম থেকে বেশি" },
  { value: "price-desc", label: "দাম: বেশি থেকে কম" },
  { value: "rating", label: "রেটিং" },
];

const RATING_OPTIONS: ReadonlyArray<{ value?: number; label: string }> = [
  { value: undefined, label: "সব রেটিং" },
  { value: 4, label: "৪★ ও উপরে" },
  { value: 3, label: "৩★ ও উপরে" },
];

/* ------------------------------------------------------------------ */
/* Sidebar pieces — stacked white cards, blue-underline headings.     */
/* ------------------------------------------------------------------ */

function SidebarCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-card">
      <h2 className="text-sm font-extrabold uppercase tracking-wide text-text-main">
        {title}
      </h2>
      <span aria-hidden="true" className="mt-1.5 block h-[3px] w-8 rounded-full bg-primary" />
      <div className="mt-3 space-y-1">{children}</div>
    </section>
  );
}

/** Checkbox-glyph row over a plain filter link. `active` fills
 *  the box blue with a check. */
function CheckLink({
  href,
  active,
  children,
  count,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
  count?: number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`flex min-h-[40px] items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition duration-200 ${
        active
          ? "font-semibold text-primary"
          : "text-text-muted hover:bg-muted hover:text-text-main"
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border text-[11px] leading-none transition duration-200 ${
          active ? "border-primary bg-primary text-white" : "border-input bg-card"
        }`}
      >
        {active ? "✓" : ""}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined ? (
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-text-subtle">
          {count}
        </span>
      ) : null}
    </Link>
  );
}

/** Radio-glyph row for the single-choice groups (price, rating). */
function RadioLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`flex min-h-[40px] items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition duration-200 ${
        active
          ? "font-semibold text-primary"
          : "text-text-muted hover:bg-muted hover:text-text-main"
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition duration-200 ${
          active ? "border-primary" : "border-input"
        }`}
      >
        {active ? <span className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* NeelShopChrome                                                      */
/* ------------------------------------------------------------------ */

export default function NeelShopChrome({
  breadcrumbCategoryLabel,
  heading,
  displayTotal,
  filtersApplied,
  resultCount,
  clearHref,
  sort,
  onSortChange,
  chips,
  busy,
  categories,
  brands,
  attrFacets,
  filterState: current,
  activeCategorySlug: category,
  activeBrand: brand,
  hasPriceFilter,
  minPoisha,
  maxPoisha,
  ratingMin,
  inStockOnly,
  buildHref,
  toggleAttr,
  pairToParam,
  children,
}: ShopChromeProps) {
  const digits = useDigitText();

  // The stacked-card filter panel — built once, placed in the
  // desktop sidebar and inside the mobile filter drawer (same
  // hrefs in both).
  const filterPanel = (
    <div className="space-y-3">
      <SidebarCard title="Filter by Category">
        <CheckLink href={buildHref(current, { category: undefined })} active={!category}>
          সব ক্যাটাগরি
        </CheckLink>
        {categories.map((c) => (
          <CheckLink
            key={c.slug}
            href={buildHref(current, { category: c.slug })}
            active={category === c.slug}
            count={c.productCount}
          >
            {c.name.bn}
          </CheckLink>
        ))}
      </SidebarCard>

      <SidebarCard title="Price Range">
        <RadioLink href={buildHref(current, { min: undefined, max: undefined })} active={!hasPriceFilter}>
          সব দাম
        </RadioLink>
        {PRICE_RANGES.map((range) => {
          const active = minPoisha === range.min && maxPoisha === range.max && hasPriceFilter;
          return (
            <RadioLink
              key={range.label}
              href={buildHref(current, {
                min: range.min !== undefined ? String(range.min) : undefined,
                max: range.max !== undefined ? String(range.max) : undefined,
              })}
              active={active}
            >
              {range.label}
            </RadioLink>
          );
        })}
      </SidebarCard>

      {brands.length > 0 ? (
        <SidebarCard title="Brands">
          <CheckLink href={buildHref(current, { brand: undefined })} active={!brand}>
            সব ব্র্যান্ড
          </CheckLink>
          {brands.map((b) => (
            <CheckLink
              key={b.slug}
              href={buildHref(current, { brand: b.name })}
              active={brand === b.name}
              count={b.productCount}
            >
              {b.name}
            </CheckLink>
          ))}
        </SidebarCard>
      ) : null}

      {attrFacets.map((facet) => (
        <SidebarCard key={facet.key} title={facet.labelBn}>
          {facet.values.map((value) => {
            const pair: ShopChromeAttrPair = { key: facet.key, value };
            const active = current.attr.includes(pairToParam(pair));
            return (
              <CheckLink key={value} href={toggleAttr(current, pair)} active={active}>
                {value}
              </CheckLink>
            );
          })}
        </SidebarCard>
      ))}

      <SidebarCard title="Rating & Availability">
        {RATING_OPTIONS.map((option) => (
          <RadioLink
            key={option.label}
            href={buildHref(current, { rating: option.value !== undefined ? String(option.value) : undefined })}
            active={ratingMin === option.value}
          >
            {option.label}
          </RadioLink>
        ))}
        <div className="border-t border-border pt-1">
          <CheckLink href={buildHref(current, { instock: undefined })} active={!inStockOnly}>
            সব পণ্য
          </CheckLink>
          <CheckLink href={buildHref(current, { instock: "1" })} active={inStockOnly}>
            শুধু স্টকে আছে
          </CheckLink>
        </div>
      </SidebarCard>
    </div>
  );

  const breadcrumb = (
    <nav aria-label="ব্রেডক্রাম্ব" className="flex flex-wrap items-center gap-1.5 text-sm text-text-subtle">
      <Link href="/" className="py-1 transition hover:text-primary">হোম</Link>
      <span aria-hidden="true" className="text-border">/</span>
      <Link href="/shop" className="py-1 transition hover:text-primary">দোকান</Link>
      {breadcrumbCategoryLabel ? (
        <>
          <span aria-hidden="true" className="text-border">/</span>
          <span className="py-1 font-medium text-text-main">{breadcrumbCategoryLabel}</span>
        </>
      ) : null}
    </nav>
  );

  return (
    <>
      {/* Header row — big H1 left, breadcrumb right. */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <h1 className="min-w-0 break-words font-display text-2xl font-extrabold text-text-main [overflow-wrap:anywhere] sm:text-3xl">
          {heading}
        </h1>
        <div className="shrink-0 pt-1">{breadcrumb}</div>
      </div>

      {/* Pale listing area — full-bleed within the page container:
          the negative margins cancel the page's own padding so the
          listing background runs edge to edge. */}
      <div className="-mx-4 mt-5 bg-surface-2 px-4 py-5 sm:-mx-6 sm:px-6 lg:-mx-6">
        <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* ---------- Filter sidebar (desktop) ---------- */}
          <aside className="hidden min-w-0 lg:block">
            <div className="lg:sticky lg:top-[10rem]">{filterPanel}</div>
          </aside>

          {/* ---------- Results ---------- */}
          <section className="min-w-0" aria-busy={busy}>
            {/* White sort bar */}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5 rounded-lg border border-border bg-card px-4 py-3 shadow-card">
              <p className="text-sm text-text-muted" aria-live="polite">
                {digits(
                  displayTotal === null
                    ? "পণ্য লোড হচ্ছে…"
                    : `Showing ${displayTotal} of ${displayTotal} products`,
                )}
                {filtersApplied ? (
                  <span className="text-text-subtle"> — ফিল্টার প্রয়োগ করা হয়েছে</span>
                ) : null}
              </p>

              <div className="flex flex-wrap items-center gap-2.5">
                {/* Mobile filter trigger — the drawer carries the
                    same stacked cards as the desktop sidebar. */}
                <div className="lg:hidden">
                  <MobileFilterDrawer resultCount={resultCount} clearHref={clearHref}>
                    {filterPanel}
                  </MobileFilterDrawer>
                </div>
                {chips.length > 0 ? (
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[13px] font-semibold text-primary lg:hidden">
                    {digits(`${chips.length}টি ফিল্টার সক্রিয়`)}
                  </span>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="shop-sort" className="hidden text-sm text-text-muted min-[420px]:block">
                    Sort By:
                  </label>
                  <select
                    id="shop-sort"
                    value={sort}
                    onChange={(e) => onSortChange(e.target.value)}
                    className="h-11 rounded-md border border-input bg-card px-2.5 text-sm text-text-main shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
                  >
                    {SORT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Active filter chips */}
            {chips.length > 0 ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {chips.map((chip) => (
                  <Link
                    key={chip.key}
                    href={chip.href}
                    aria-label={`${chip.label} ফিল্টার সরান`}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 py-1.5 pl-3.5 pr-2 text-[13px] font-medium text-primary transition duration-200 hover:bg-primary/20 active:scale-[0.97]"
                  >
                    {chip.label}
                    <span
                      aria-hidden="true"
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-sm leading-none"
                    >
                      ×
                    </span>
                  </Link>
                ))}
                <Link
                  href="/shop"
                  className="inline-flex min-h-[36px] items-center px-1 text-[13px] font-semibold text-text-muted underline-offset-2 transition hover:text-primary hover:underline"
                >
                  সব ফিল্টার মুছুন
                </Link>
              </div>
            ) : null}

            {/* Results / loading / empty states — ShopBrowser's block.
                The grid inside renders ThemedProductCard, which
                resolves to this package's card under Neel. */}
            <div className="mt-4">{children}</div>
          </section>
        </div>
      </div>
    </>
  );
}
