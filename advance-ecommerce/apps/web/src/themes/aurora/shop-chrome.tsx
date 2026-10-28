"use client";

/**
 * Aurora ShopChrome slot — doc 25 §1.4 / wave S3b.
 *
 * The /shop sidebar + toolbar composition, MOVED VERBATIM from
 * app/(store)/shop/ShopBrowser.tsx: same markup, same classes, same
 * conditional logic, same option lists. ShopBrowser keeps ALL state,
 * fetching, URL parsing and href building and passes the derived
 * values in (see ShopChromeProps in src/themes/slots.ts); this
 * component only arranges them. The filter panel is built here from
 * the props because it renders twice — desktop sidebar card and
 * mobile filter drawer — from one construction, exactly as the
 * inline version built one `filterPanel` node and placed it twice.
 *
 * The MobileFilterDrawer import reaches into app/(store)/shop by
 * relative path: the drawer is a route-local component (no src/
 * equivalent), and this slot is that route's chrome.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import type {
  ShopChromeAttrPair,
  ShopChromeProps,
} from "../slots";
import { MobileFilterDrawer } from "../../../app/(store)/shop/MobileFilterDrawer";
import { interpolate, pick } from "@/i18n/locale";
import { useLocale } from "@/i18n/LocaleProvider";
import { AURORA_STRINGS, type AuroraStrings } from "./strings";

// Option VALUES (URL params) are locale-independent and stay
// byte-identical; only the display labels localise (doc 30), so the
// lists carry AURORA_STRINGS keys resolved at render time.
const PRICE_RANGES: ReadonlyArray<{ labelKey: keyof AuroraStrings; min?: number; max?: number }> = [
  { labelKey: "priceUnder500", max: 50000 },
  { labelKey: "price500to1000", min: 50000, max: 100000 },
  { labelKey: "price1000to3000", min: 100000, max: 300000 },
  { labelKey: "priceOver3000", min: 300000 },
];

const SORT_OPTIONS: ReadonlyArray<{ value: string; labelKey: keyof AuroraStrings }> = [
  { value: "relevance", labelKey: "sortRelevance" },
  { value: "newest", labelKey: "sortNewest" },
  { value: "price-asc", labelKey: "sortPriceAsc" },
  { value: "price-desc", labelKey: "sortPriceDesc" },
  { value: "rating", labelKey: "sortRating" },
];

const RATING_OPTIONS: ReadonlyArray<{ value?: number; labelKey: keyof AuroraStrings }> = [
  { value: undefined, labelKey: "ratingAll" },
  { value: 4, labelKey: "rating4Up" },
  { value: 3, labelKey: "rating3Up" },
];

/* ------------------------------------------------------------------ */
/* Presentational pieces — markup identical to the server page.        */
/* (Moved verbatim from ShopBrowser.tsx.)                              */
/* ------------------------------------------------------------------ */

function FilterSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group border-b border-border py-3 last:border-b-0">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between rounded-lg px-1 text-sm font-bold text-text-main transition duration-200 hover:text-brand-700 dark:hover:text-brand-300 [&::-webkit-details-marker]:hidden">
        {title}
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-text-subtle transition duration-300 group-open:rotate-180">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </summary>
      <div className="mb-2 mt-1 space-y-1">{children}</div>
    </details>
  );
}

function SidebarLink({
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
      className={`flex min-h-[44px] lg:min-h-[40px] items-center justify-between rounded-xl px-3 py-2 text-sm transition duration-200 ${
        active
          ? "bg-brand-500/10 font-semibold text-brand-700 dark:text-brand-200"
          : "text-text-muted hover:bg-surface-2 hover:text-text-main"
      }`}
    >
      <span className="min-w-0 truncate">{children}</span>
      {count !== undefined ? (
        <span
          className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[11px] tabular-nums ${
            active ? "bg-brand-600/10 text-brand-700 dark:text-brand-200" : "bg-surface-2 text-text-subtle"
          }`}
        >
          {count}
        </span>
      ) : null}
    </Link>
  );
}

/** Multi-select attribute row: a toggle link with a checkbox glyph. */
function AttrToggleLink({
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
      aria-pressed={active}
      className={`flex min-h-[44px] lg:min-h-[40px] items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition duration-200 ${
        active
          ? "bg-brand-500/5 font-semibold text-brand-700 dark:text-brand-200"
          : "text-text-muted hover:bg-surface-2 hover:text-text-main"
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] leading-none transition duration-200 ${
          active ? "border-brand-600 bg-brand-600 text-white shadow-sm" : "border-border bg-card"
        }`}
      >
        {active ? "✓" : ""}
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* AuroraShopChrome                                                    */
/* ------------------------------------------------------------------ */

export default function AuroraShopChrome({
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
  const { locale, t } = useLocale();
  const s = pick(locale, AURORA_STRINGS);
  // Filter panel content — rendered ONCE as a node, then placed in the
  // desktop sidebar card and inside the mobile filter drawer. Same
  // GET-param links in both, so behaviour is identical.
  const filterPanel = (
    <>
      <FilterSection title={t.categories}>
        <SidebarLink href={buildHref(current, { category: undefined })} active={!category}>
          {s.allCategories}
        </SidebarLink>
        {categories.map((c) => (
          <SidebarLink
            key={c.slug}
            href={buildHref(current, { category: c.slug })}
            active={category === c.slug}
            count={c.productCount}
          >
            {c.name[locale] || c.name.bn}
          </SidebarLink>
        ))}
      </FilterSection>

      <FilterSection title={s.priceFilterTitle}>
        <SidebarLink href={buildHref(current, { min: undefined, max: undefined })} active={!hasPriceFilter}>
          {s.allPrices}
        </SidebarLink>
        {PRICE_RANGES.map((range) => {
          const active = minPoisha === range.min && maxPoisha === range.max && hasPriceFilter;
          return (
            <SidebarLink
              key={range.labelKey}
              href={buildHref(current, {
                min: range.min !== undefined ? String(range.min) : undefined,
                max: range.max !== undefined ? String(range.max) : undefined,
              })}
              active={active}
            >
              {s[range.labelKey]}
            </SidebarLink>
          );
        })}
      </FilterSection>

      {brands.length > 0 ? (
        <FilterSection title={s.brandFilterTitle}>
          <SidebarLink href={buildHref(current, { brand: undefined })} active={!brand}>
            {s.allBrands}
          </SidebarLink>
          {brands.map((b) => (
            <SidebarLink key={b.slug} href={buildHref(current, { brand: b.name })} active={brand === b.name} count={b.productCount}>
              {b.name}
            </SidebarLink>
          ))}
        </FilterSection>
      ) : null}

      <FilterSection title={s.ratingFilterTitle}>
        {RATING_OPTIONS.map((option) => (
          <SidebarLink
            key={option.labelKey}
            href={buildHref(current, { rating: option.value !== undefined ? String(option.value) : undefined })}
            active={ratingMin === option.value}
          >
            {s[option.labelKey]}
          </SidebarLink>
        ))}
      </FilterSection>

      {attrFacets.map((facet) => (
        <FilterSection key={facet.key} title={locale === "bn" ? facet.labelBn : facet.labelEn || facet.labelBn}>
          {facet.values.map((value) => {
            const pair: ShopChromeAttrPair = { key: facet.key, value };
            const active = current.attr.includes(pairToParam(pair));
            return (
              <AttrToggleLink key={value} href={toggleAttr(current, pair)} active={active}>
                {value}
              </AttrToggleLink>
            );
          })}
        </FilterSection>
      ))}

      <FilterSection title={s.availabilityTitle}>
        <SidebarLink href={buildHref(current, { instock: undefined })} active={!inStockOnly}>
          {t.allProducts}
        </SidebarLink>
        <SidebarLink href={buildHref(current, { instock: "1" })} active={inStockOnly}>
          {s.inStockOnlyLabel}
        </SidebarLink>
      </FilterSection>
    </>
  );

  return (
    <>
      {/* Breadcrumb */}
      <nav aria-label={s.breadcrumbAria} className="flex flex-wrap items-center gap-1.5 text-sm text-text-subtle">
        <Link href="/" className="hover:text-brand-700">{t.home}</Link>
        <span aria-hidden="true">/</span>
        <Link href="/shop" className="hover:text-brand-700">{s.shopBreadcrumb}</Link>
        {breadcrumbCategoryLabel ? (
          <>
            <span aria-hidden="true">/</span>
            <span className="font-medium text-text-main">{breadcrumbCategoryLabel}</span>
          </>
        ) : null}
      </nav>

      <div className="mt-4 grid gap-6 lg:grid-cols-[270px_minmax(0,1fr)] lg:gap-8">
        {/* ---------- Filter sidebar (desktop) ---------- */}
        <aside className="hidden min-w-0 lg:block">
          <div className="rounded-3xl border border-border bg-card px-5 py-2 shadow-card lg:sticky lg:top-[8.5rem]">
            {filterPanel}
          </div>
        </aside>

        {/* ---------- Results ---------- */}
        <section className="min-w-0" aria-busy={busy}>
          {/* Toolbar — Wave 17: on mobile this is a sticky glass bar
              pinned under the h-16 site header (top-16) carrying the
              heading, result count, filter drawer trigger and sort;
              on lg it relaxes back into a plain static header row. */}
          <div className="sticky top-16 z-30 -mx-4 border-b border-border/60 bg-bg-app/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-b-0 lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-none">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5">
              <div className="min-w-0">
                <h1 className="break-words font-display text-h1 text-text-main [overflow-wrap:anywhere]">{heading}</h1>
                <p className="mt-0.5 text-sm text-text-muted">
                  {interpolate(s.productsCountLine, { count: displayTotal === null ? "…" : displayTotal })}
                  {filtersApplied ? s.filtersAppliedSuffix : ""}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {/* Mobile filter trigger (Design v3) — the drawer lives
                    here now so it stays reachable inside the sticky bar. */}
                <div className="flex flex-wrap items-center gap-2.5 lg:hidden">
                  <MobileFilterDrawer
                    resultCount={resultCount}
                    clearHref={clearHref}
                  >
                    {filterPanel}
                  </MobileFilterDrawer>
                  {chips.length > 0 ? (
                    <span className="rounded-full bg-brand-500/10 px-2.5 py-1 text-[13px] font-semibold text-brand-700 dark:text-brand-200">
                      {interpolate(s.activeFiltersCount, { count: chips.length })}
                    </span>
                  ) : null}
                </div>

                {/* Sort — controlled select (was a GET form on the
                    server page): changing it pushes the same `sort`
                    param via buildHref, so every other active filter
                    rides along exactly as the hidden inputs did. */}
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="shop-sort" className="hidden text-sm text-text-muted xs:block">
                    {s.sortByLabel}
                  </label>
                  <select
                    id="shop-sort"
                    value={sort}
                    onChange={(e) => onSortChange(e.target.value)}
                    className="h-11 rounded-xl border border-border bg-card px-2.5 text-sm text-text-main shadow-sm outline-none transition focus:border-brand-500"
                  >
                    {SORT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {s[o.labelKey]}
                      </option>
                    ))}
                  </select>
                </div>
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
                  className="inline-flex min-h-[44px] lg:min-h-[36px] items-center gap-1.5 rounded-full border border-brand-600/15 bg-brand-500/10 py-1.5 pl-3.5 pr-2 text-[13px] font-medium text-brand-700 transition duration-200 hover:bg-brand-500/20 active:scale-[0.97] dark:text-brand-200"
                >
                  {chip.label}
                  <span
                    aria-hidden="true"
                    className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600/15 text-sm leading-none"
                  >
                    ×
                  </span>
                </Link>
              ))}
              <Link href="/shop" className="inline-flex min-h-[44px] lg:min-h-[36px] items-center px-1 text-[13px] font-semibold text-text-muted underline-offset-2 transition hover:text-brand-700 hover:underline dark:hover:text-brand-300">
                {s.clearAllFilters}
              </Link>
            </div>
          ) : null}

          {/* Results / loading / empty states — ShopBrowser's block. */}
          {children}
        </section>
      </div>
    </>
  );
}
