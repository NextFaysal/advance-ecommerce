"use client";

/**
 * Bazaar ShopChrome slot — doc 24 wave T4 / doc 25 wave S4b.
 *
 * The /shop (and category) composition in the grocery layout:
 * a category-landing header row (big H1 left, breadcrumb right)
 * when a category is active, then a pale listing area — a LEFT
 * sidebar of stacked white cards and a white sort bar over the
 * results grid. ShopBrowser keeps ALL state, fetching, URL parsing
 * and href building; this chrome only arranges the props it is
 * handed (see ShopChromeProps in src/themes/slots.ts), exactly
 * like Aurora's chrome.
 *
 * Filter honesty — the sidebar presents ONLY the filter dimensions
 * ShopChromeProps actually carries, each wired to the same href
 * builders Aurora uses (identical URLs, identical behaviour):
 * - "FILTER BY CATEGORY": the category filter, checkbox-STYLED
 *   (the reference's look) but with the platform's real
 *   single-select link semantics — the same hrefs Aurora's sidebar
 *   produces.
 * - "PRICE RANGE": the platform's preset price ranges (links, as
 *   in Aurora). There is NO dual-handle slider: the existing price
 *   filter is preset ranges, and a slider that does not filter
 *   would be a lie.
 * - "BRANDS": the brand filter, checkbox-styled links.
 * - Attribute facets: the shop's real multi-select toggles.
 * - "RATING & AVAILABILITY": the rating floor + in-stock filters —
 *   the honest contents of the reference's "product flag" card
 *   position. Flags the platform cannot filter by (Pre Order,
 *   Free Delivery, …) are NOT shown.
 *
 * The per-page selector from the reference is not rendered:
 * ShopChromeProps carries no page-size control, and inventing one
 * would break the URL contract ShopBrowser owns. Pagination stays
 * ShopBrowser's, inside `children`.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { useDigitText } from "@/components/ui/numerals";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import type { ShopChromeAttrPair, ShopChromeProps } from "../slots";
import { MobileFilterDrawer } from "../../../app/(store)/shop/MobileFilterDrawer";
import { BAZAAR_STRINGS, type BazaarStrings } from "./strings";

/* Same preset ranges + sort options Aurora's chrome offers —
 * ShopBrowser's URL contract values, unchanged. Labels come from
 * the theme dictionary (doc 30) so they follow the active locale. */
function priceRanges(s: BazaarStrings): ReadonlyArray<{ label: string; min?: number; max?: number }> {
  return [
    { label: s.priceRangeUnder500, max: 50000 },
    { label: s.priceRange500to1000, min: 50000, max: 100000 },
    { label: s.priceRange1000to3000, min: 100000, max: 300000 },
    { label: s.priceRangeOver3000, min: 300000 },
  ];
}

function sortOptions(s: BazaarStrings): ReadonlyArray<{ value: string; label: string }> {
  return [
    { value: "relevance", label: s.sortRelevance },
    { value: "newest", label: s.sortNewest },
    { value: "price-asc", label: s.sortPriceAsc },
    { value: "price-desc", label: s.sortPriceDesc },
    { value: "rating", label: s.sortRating },
  ];
}

function ratingOptions(s: BazaarStrings): ReadonlyArray<{ value?: number; label: string }> {
  return [
    { value: undefined, label: s.ratingAll },
    { value: 4, label: s.rating4Plus },
    { value: 3, label: s.rating3Plus },
  ];
}

/* ------------------------------------------------------------------ */
/* Sidebar pieces — stacked white cards, orange-underline headings.    */
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

/** Checkbox-glyph row: the reference sidebar's look over a plain
 *  filter link. `active` fills the box orange with a check. */
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
/* BazaarShopChrome                                                    */
/* ------------------------------------------------------------------ */

export default function BazaarShopChrome({
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
  const { locale } = useLocale();
  const s = pick(locale, BAZAAR_STRINGS);
  const PRICE_RANGES = priceRanges(s);
  const SORT_OPTIONS = sortOptions(s);
  const RATING_OPTIONS = ratingOptions(s);
  const digits = useDigitText();

  // The stacked-card filter panel — built once, placed in the
  // desktop sidebar and inside the mobile filter drawer, exactly
  // like Aurora's panel (same hrefs in both).
  const filterPanel = (
    <div className="space-y-3">
      <SidebarCard title={s.filterByCategory}>
        <CheckLink href={buildHref(current, { category: undefined })} active={!category}>
          {s.allCategories}
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

      <SidebarCard title={s.priceRangeTitle}>
        <RadioLink href={buildHref(current, { min: undefined, max: undefined })} active={!hasPriceFilter}>
          {s.allPrices}
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
        <SidebarCard title={s.brandsTitle}>
          <CheckLink href={buildHref(current, { brand: undefined })} active={!brand}>
            {s.allBrands}
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
        <SidebarCard key={facet.key} title={locale === "bn" ? facet.labelBn : facet.labelEn || facet.labelBn}>
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

      <SidebarCard title={s.ratingAvailabilityTitle}>
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
            {s.allProductsFilter}
          </CheckLink>
          <CheckLink href={buildHref(current, { instock: "1" })} active={inStockOnly}>
            {s.inStockOnlyFilter}
          </CheckLink>
        </div>
      </SidebarCard>
    </div>
  );

  const breadcrumb = (
    <nav aria-label={s.breadcrumbAria} className="flex flex-wrap items-center gap-1.5 text-sm text-text-subtle">
      <Link href="/" className="py-1 transition hover:text-primary">{s.homeCrumb}</Link>
      <span aria-hidden="true" className="text-border">/</span>
      <Link href="/shop" className="py-1 transition hover:text-primary">{s.shopCrumb}</Link>
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
      {/* Header row — category landing treatment: big H1 left,
          breadcrumb right (the reference category page). On the
          plain shop view the same row carries the shop heading. */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <h1 className="min-w-0 break-words font-display text-2xl font-extrabold text-text-main [overflow-wrap:anywhere] sm:text-3xl">
          {heading}
        </h1>
        <div className="shrink-0 pt-1">{breadcrumb}</div>
      </div>

      {/* Pale listing area — full-bleed within the page container:
          the negative margins cancel the page's own padding so the
          listing background runs edge to edge like the reference. */}
      <div className="-mx-4 mt-5 bg-surface-2 px-4 py-5 sm:-mx-6 sm:px-6 lg:-mx-6">
        <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* ---------- Filter sidebar (desktop) ---------- */}
          <aside className="hidden min-w-0 lg:block">
            <div className="lg:sticky lg:top-[9.5rem]">{filterPanel}</div>
          </aside>

          {/* ---------- Results ---------- */}
          <section className="min-w-0" aria-busy={busy}>
            {/* White sort bar */}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5 rounded-lg border border-border bg-card px-4 py-3 shadow-card">
              <p className="text-sm text-text-muted" aria-live="polite">
                {digits(
                  displayTotal === null
                    ? s.loadingProducts
                    : interpolate(s.showingProducts, { shown: displayTotal, total: displayTotal }),
                )}
                {filtersApplied ? (
                  <span className="text-text-subtle">{s.filtersAppliedSuffix}</span>
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
                    {digits(interpolate(s.activeFiltersCount, { count: chips.length }))}
                  </span>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="shop-sort" className="hidden text-sm text-text-muted min-[420px]:block">
                    {s.sortByLabel}
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
                    aria-label={interpolate(s.removeFilterAria, { label: chip.label })}
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
                  {s.clearAllFilters}
                </Link>
              </div>
            ) : null}

            {/* Results / loading / empty states — ShopBrowser's block.
                The grid inside renders ThemedProductCard, which
                resolves to this package's card under Bazaar. */}
            <div className="mt-4">{children}</div>
          </section>
        </div>
      </div>
    </>
  );
}
