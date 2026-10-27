"use client";

/**
 * Shobji ShopChrome slot — doc 27 theme T-B.
 *
 * The /shop (and category) composition in the sidebar-grocery
 * layout: a heading row (big H1 left, breadcrumb right), then a
 * lavender listing area holding — on desktop — TWO left columns:
 * this package's persistent category sidebar (the layout
 * signature: real categories, real /shop?category= links, the
 * browsed category active) and the stacked filter cards; the
 * results sit right, under a white sort bar. ShopBrowser keeps
 * ALL state, fetching, URL parsing and href building; this chrome
 * only arranges the props it is handed (see ShopChromeProps in
 * src/themes/slots.ts).
 *
 * Filter honesty — the sidebar presents ONLY the filter dimensions
 * ShopChromeProps actually carries, each wired to the same href
 * builders the other packages use (identical URLs, identical
 * behaviour):
 * - Category navigation: the package sidebar (real links), plus a
 *   checkbox-STYLED category card mirroring it for the filter
 *   panel — both are the platform's real single-select semantics.
 * - "দামের পরিসর": the platform's preset price ranges (links).
 *   There is NO dual-handle slider: the existing price filter is
 *   preset ranges, and a slider that does not filter would be a
 *   lie.
 * - "ব্র্যান্ড": the brand filter, checkbox-styled links.
 * - Attribute facets: the shop's real multi-select toggles.
 * - "রেটিং ও স্টক": the rating floor + in-stock filters. Flags
 *   the platform cannot filter by are NOT shown.
 *
 * The per-page selector from sidebar-grocery references is not
 * rendered: ShopChromeProps carries no page-size control, and
 * inventing one would break the URL contract ShopBrowser owns.
 * Pagination stays ShopBrowser's, inside `children`.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { useDigitText } from "@/components/ui/numerals";
import { useThemeView } from "../theme-view";
import type { ShopChromeAttrPair, ShopChromeProps } from "../slots";
import { MobileFilterDrawer } from "../../../app/(store)/shop/MobileFilterDrawer";
import ShobjiCategorySidebar from "./category-sidebar";

/* Same preset ranges + sort options the other chromes offer —
 * ShopBrowser's URL contract values, unchanged. */
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
/* Sidebar pieces — stacked white cards, purple-underline headings.   */
/* ------------------------------------------------------------------ */

function SidebarCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-card">
      <h2 className="text-sm font-extrabold uppercase tracking-wide text-text-main">
        {title}
      </h2>
      <span aria-hidden="true" className="mt-1.5 block h-[3px] w-8 rounded-full bg-primary" />
      <div className="mt-3 space-y-1">{children}</div>
    </section>
  );
}

/** Checkbox-glyph row: the sidebar look over a plain filter link.
 *  `active` fills the box purple with a check. */
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
/* ShobjiShopChrome                                                    */
/* ------------------------------------------------------------------ */

export default function ShobjiShopChrome({
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
  const themeView = useThemeView();
  const showSidebar = themeView.options.showSidebar !== false;

  // The stacked-card filter panel — built once, placed in the
  // desktop rail (below the category sidebar) and inside the
  // mobile filter drawer (same hrefs in both).
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

      <SidebarCard title="দামের পরিসর">
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
        <SidebarCard title="ব্র্যান্ড">
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

      <SidebarCard title="রেটিং ও স্টক">
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

      {/* Lavender listing area — full-bleed within the page
          container: the negative margins cancel the page's own
          padding so the listing background runs edge to edge. */}
      <div className="-mx-4 mt-5 bg-surface-2 px-4 py-5 sm:-mx-6 sm:px-6 lg:-mx-6">
        <div className="flex items-start gap-5">
          {/* ---------- LEFT: category sidebar + filters ---------- */}
          <div className="hidden shrink-0 lg:block">
            <div className="space-y-4">
              {/* The package signature: persistent category sidebar
                  (reads the showSidebar option itself; on /shop the
                  browsed category is active). */}
              <ShobjiCategorySidebar
                categories={categories.map((c) => ({
                  slug: c.slug,
                  nameBn: c.name.bn,
                  productCount: c.productCount,
                }))}
                activeCategorySlug={category}
              />
              {/* The filter cards occupy the same rail under the
                  sidebar — or the rail alone when the sidebar is
                  switched off. */}
              <div className={showSidebar ? "w-[220px] xl:w-[240px]" : "w-[260px]"}>
                {filterPanel}
              </div>
            </div>
          </div>

          {/* ---------- Results ---------- */}
          <section className="min-w-0 flex-1" aria-busy={busy}>
            {/* White sort bar */}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5 rounded-xl border border-border bg-card px-4 py-3 shadow-card">
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
                    same stacked cards as the desktop rail. */}
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
                resolves to this package's card under Shobji. */}
            <div className="mt-4">{children}</div>
          </section>
        </div>
      </div>
    </>
  );
}
