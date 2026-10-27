"use client";

// ShopBrowser — Wave 47 (shop speed): the whole /shop UI, moved
// client-side out of the old per-request server page. State lives in
// the URL (useSearchParams is the single source of truth — the param
// contract category/brand/sort/min/max/instock/q/rating/attr is
// byte-identical to the server page's, and every control is a
// shareable <Link> or a router.push, so links behave as before, just
// without a full page load). Data comes from the edge-cached public
// APIs: facet libraries (categories tree, brands, attribute sets) are
// fetched once on mount; products are fetched whenever the effective
// filter query changes.
//
// Filter exactness — carried over from the server page (Wave 16-1):
// - Category, brand, price, stock, query, rating AND attribute
//   filters are EXACT: the products API evaluates them server-side,
//   so "মোট Nটি পণ্য" (meta.total) is a catalogue-wide count.
//   Attribute filters ride as repeated attr=key:value params
//   whenever the selection fits the API's one-value-per-key
//   contract: at most one selected value per attribute key.
// - One case still filters IN-PAGE over the fetched page (capped at
//   pageSize 100); with it active, the displayed total is the
//   filtered count WITHIN that page, not a catalogue-wide count:
//   attribute selections with MULTIPLE values for one key — the
//   one-value-per-key contract cannot express OR-within-a-key, so
//   that matching stays local (applyLocalFilters), exactly as before.
// - Attribute facets are scoped to the PRE-attribute-filter result
//   set (when the products fetch carries attr params, a second fetch
//   without them provides the facet base), so selecting a value never
//   hides its sibling values — same facetResult pattern as the
//   server page.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import type { PublicProduct } from "@/catalog/types";
import type { SortOption } from "@/catalog/search";
import type { PublicBrand } from "@/catalog/public-brands";
import type { AdminAttributeSet } from "@/catalog/attributes-admin";
import { useThemeView } from "@/themes/theme-view";
import { ThemeBoundary } from "@/themes/theme-boundary";
import { getShopChromeSlot, AURORA_SHOP_CHROME } from "@/themes/client-shop-registry";
import { ThemedProductCard } from "@/themes/themed-product-card";
import type { ShopChromeProps } from "@/themes/slots";
import { interpolate, pick } from "@/i18n/locale";
import { useLocale } from "@/i18n/LocaleProvider";
import { STORE_STRINGS } from "../store-strings";

// Default document title lives in STORE_STRINGS (shopDefaultTitle, doc 30).

/* ------------------------------------------------------------------ */
/* Public API payload shapes                                           */
/* ------------------------------------------------------------------ */

/** Node of GET /api/v1/public/categories (the category TREE: every
 *  flat field the shop used — slug, name{bn,en}, productCount — plus
 *  SEO fields and nested children). */
interface CategoryApiNode {
  slug: string;
  name: { bn: string; en: string };
  imageUrl: string | null;
  productCount: number;
  seoTitle: { bn: string | null; en: string | null } | null;
  seoDescription: { bn: string | null; en: string | null } | null;
  children: CategoryApiNode[];
}

/** The sidebar facet list is FLAT (slug + productCount), like the old
 *  page's listCategories() — flatten the tree pre-order (parent
 *  before its children, siblings in payload order). */
function flattenCategoryTree(nodes: CategoryApiNode[]): CategoryApiNode[] {
  const out: CategoryApiNode[] = [];
  const walk = (list: CategoryApiNode[]) => {
    for (const node of list) {
      out.push(node);
      walk(node.children ?? []);
    }
  };
  walk(nodes);
  return out;
}

interface ProductsApiResult {
  products: PublicProduct[];
  total: number;
  /** Products of the pre-attribute-filter fetch (facet base), or
   *  null when no second fetch was needed — facet base = products. */
  facetBase: PublicProduct[] | null;
}

async function fetchJsonData<T>(url: string): Promise<T[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const json: unknown = await res.json();
  const data = (json as { data?: unknown }).data;
  return Array.isArray(data) ? (data as T[]) : [];
}

async function fetchProductsPage(
  query: string,
): Promise<{ products: PublicProduct[]; total: number }> {
  const res = await fetch(`/api/v1/public/products?${query}`);
  if (!res.ok) throw new Error(`GET products -> ${res.status}`);
  const json: unknown = await res.json();
  const data = (json as { data?: unknown }).data;
  const products = Array.isArray(data) ? (data as PublicProduct[]) : [];
  const total = (json as { meta?: { total?: unknown } }).meta?.total;
  return { products, total: typeof total === "number" ? total : products.length };
}

/* ------------------------------------------------------------------ */
/* URL param parsing — moved verbatim from the server page.            */
/* SearchParams are strings; parse defensively, never trust the URL.   */
/* ------------------------------------------------------------------ */

function parseSort(value: string | string[] | undefined): SortOption {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === "price-asc" || v === "price-desc" || v === "rating" || v === "newest") return v;
  return "relevance";
}

function parsePoisha(value: string | string[] | undefined): number | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

function first(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v ? v : undefined;
}

/** Rating filter: only the two offered thresholds are honoured. */
function parseRating(value: string | string[] | undefined): number | undefined {
  const v = first(value);
  if (v === "4") return 4;
  if (v === "3") return 3;
  return undefined;
}

interface AttrPair {
  key: string;
  value: string;
}

function pairToParam(pair: AttrPair): string {
  return `${pair.key}:${pair.value}`;
}

/** attr params arrive as repeated `attr=key:value` strings. */
function parseAttrs(value: string | string[] | undefined): AttrPair[] {
  const raw = value === undefined ? [] : Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const pairs: AttrPair[] = [];
  for (const entry of raw) {
    const idx = entry.indexOf(":");
    if (idx <= 0) continue;
    const key = entry.slice(0, idx).trim();
    const val = entry.slice(idx + 1).trim();
    if (!key || !val) continue;
    const id = pairToParam({ key, value: val });
    if (seen.has(id)) continue;
    seen.add(id);
    pairs.push({ key, value: val });
  }
  return pairs;
}

interface ShopState {
  category?: string;
  brand?: string;
  sort?: string;
  min?: string;
  max?: string;
  instock?: string;
  q?: string;
  rating?: string;
  /** Raw "key:value" entries, one per selected attribute value. */
  attr: string[];
}

/** Merge current state with overrides (undefined clears a single key). */
function buildHref(current: ShopState, overrides: Partial<ShopState>): string {
  const merged: ShopState = { ...current, ...overrides };
  const qs = new URLSearchParams();
  (Object.keys(merged) as Array<keyof ShopState>).forEach((key) => {
    if (key === "attr") return;
    const value = merged[key];
    if (typeof value === "string" && value !== "") qs.set(key, value);
  });
  for (const entry of merged.attr) qs.append("attr", entry);
  const query = qs.toString();
  return query ? `/shop?${query}` : "/shop";
}

function toggleAttr(state: ShopState, pair: AttrPair): string {
  const id = pairToParam(pair);
  const attr = state.attr.includes(id) ? state.attr.filter((a) => a !== id) : [...state.attr, id];
  return buildHref(state, { attr });
}

function TakaShort(poisha: number): string {
  return `৳${(poisha / 100).toLocaleString("en-IN")}`;
}

/* ------------------------------------------------------------------ */
/* Presentational pieces — the filter panel pieces (FilterSection,     */
/* SidebarLink, AttrToggleLink) and the option lists moved verbatim    */
/* into the Aurora ShopChrome slot (src/themes/aurora/shop-chrome.tsx) */
/* in wave S3b; ShopBrowser keeps the results-block pieces below.      */
/* ------------------------------------------------------------------ */

function EmptyState({
  title,
  description,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  description: string;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <div className="anim-rise flex flex-col items-center rounded-3xl border border-dashed border-border bg-card px-6 py-16 text-center shadow-card">
      <span className="brand-gradient flex h-[72px] w-[72px] items-center justify-center rounded-full text-white shadow-lift ring-8 ring-brand-500/10">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.8-3.8" />
          <path d="M8.5 11h5" />
        </svg>
      </span>
      <h2 className="mt-5 font-display text-xl font-bold text-text-main">{title}</h2>
      <p className="mt-2 max-w-md break-words text-sm leading-6 text-text-muted [overflow-wrap:anywhere]">
        {description}
      </p>
      <Link
        href={ctaHref}
        className="brand-gradient mt-6 inline-flex min-h-[44px] items-center rounded-xl px-6 py-2.5 text-sm font-semibold text-white shadow-md transition duration-200 hover:opacity-90 hover:shadow-lift active:scale-[0.98]"
      >
        {ctaLabel}
      </Link>
    </div>
  );
}

/** Grid placeholder while the first products response is in flight —
 *  same card silhouette as shop/loading.tsx, in this page's grid. */
function ShopCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <Skeleton className="aspect-[4/5] w-full rounded-none" />
      <div className="space-y-2 px-3.5 py-3">
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3.5 w-3/5" />
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  );
}

/** In-page predicates for the one filter case the API cannot take
 *  (see the header's exactness note): attribute pairs only when the
 *  caller passes them — i.e. the multi-value-per-key case.
 *  Server-expressible attribute filters and the rating floor are NOT
 *  passed here; the API already applied them. */
function applyLocalFilters(products: PublicProduct[], attrs: AttrPair[]): PublicProduct[] {
  let out = products;
  if (attrs.length > 0) {
    const byKey = new Map<string, Set<string>>();
    for (const pair of attrs) {
      const set = byKey.get(pair.key) ?? new Set<string>();
      set.add(pair.value);
      byKey.set(pair.key, set);
    }
    out = out.filter((p) =>
      [...byKey.entries()].every(([key, values]) =>
        p.variants.some((v) => v.isActive && values.has(v.attributes[key] ?? "")),
      ),
    );
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* ShopBrowser                                                         */
/* ------------------------------------------------------------------ */

export function ShopBrowser() {
  const { locale, t } = useLocale();
  const s = pick(locale, STORE_STRINGS);
  const router = useRouter();
  const searchParams = useSearchParams();
  const mainRef = useRef<HTMLElement | null>(null);
  const hasLoadedOnceRef = useRef(false);
  // ShopChrome slot (S3b): resolved from the ThemeView context via
  // the client-safe shop registry (per-slot Aurora fallback built
  // in); rendered at the bottom of this component with every derived
  // value this state owner computes.
  const themeView = useThemeView();
  const ShopChrome = getShopChromeSlot(themeView.packageId);

  /* ---- URL state (single source of truth, same parsing as before) -- */
  const attrPairs = useMemo(
    () => parseAttrs(searchParams.getAll("attr")),
    [searchParams],
  );
  const current: ShopState = {
    category: first(searchParams.get("category") ?? undefined),
    brand: first(searchParams.get("brand") ?? undefined),
    sort: first(searchParams.get("sort") ?? undefined),
    min: first(searchParams.get("min") ?? undefined),
    max: first(searchParams.get("max") ?? undefined),
    instock: first(searchParams.get("instock") ?? undefined),
    q: first(searchParams.get("q") ?? undefined),
    rating: first(searchParams.get("rating") ?? undefined),
    attr: attrPairs.map(pairToParam),
  };
  const { category, brand, q } = current;
  const sort = parseSort(searchParams.get("sort") ?? undefined);
  const minPoisha = parsePoisha(searchParams.get("min") ?? undefined);
  const maxPoisha = parsePoisha(searchParams.get("max") ?? undefined);
  const inStockOnly = searchParams.get("instock") === "1";
  const ratingMin = parseRating(searchParams.get("rating") ?? undefined);

  // Attribute filters go to the API (exact totals) when the selection
  // fits its one-value-per-key contract. Multiple values for one key
  // would need OR-within-a-key, which that contract cannot express;
  // those pairs stay in-page (hasLocalAttrFilter).
  const attrValuesByKey = new Map<string, string[]>();
  for (const pair of attrPairs) {
    const arr = attrValuesByKey.get(pair.key) ?? [];
    arr.push(pair.value);
    attrValuesByKey.set(pair.key, arr);
  }
  const attrServerExpressible =
    attrPairs.length > 0 && [...attrValuesByKey.values()].every((vals) => vals.length === 1);
  const attributeFilters: Record<string, string> | undefined = attrServerExpressible
    ? Object.fromEntries(attrPairs.map((p) => [p.key, p.value]))
    : undefined;
  const hasLocalAttrFilter = attrPairs.length > 0 && !attrServerExpressible;
  // Anything still filtered in-page (attrs only, in the multi-value
  // case) makes the displayed total a within-page count instead of
  // the API total — see the header note. Rating rides the API
  // filter and stays exact.
  const hasLocalFilter = hasLocalAttrFilter;

  /* ---- Facet libraries: fetched once on mount; each degrades to
   *  [] on failure (facet hidden), exactly like the server page — a
   *  facet outage must never take the shop down. ---- */
  const [categories, setCategories] = useState<CategoryApiNode[]>([]);
  const [brands, setBrands] = useState<PublicBrand[]>([]);
  const [attributeSets, setAttributeSets] = useState<AdminAttributeSet[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [cats, brs, sets] = await Promise.all([
        fetchJsonData<CategoryApiNode>("/api/v1/public/categories").catch(
          (): CategoryApiNode[] => [],
        ),
        fetchJsonData<PublicBrand>("/api/v1/public/brands").catch((): PublicBrand[] => []),
        fetchJsonData<AdminAttributeSet>("/api/v1/public/catalog/attribute-sets").catch(
          (): AdminAttributeSet[] => [],
        ),
      ]);
      if (cancelled) return;
      setCategories(flattenCategoryTree(cats));
      setBrands(brs);
      setAttributeSets(sets);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- Products: refetched whenever the effective filter query
   *  changes. Param-name translations from the shop contract to the
   *  API contract: min -> minPricePoisha, max -> maxPricePoisha,
   *  instock=1 -> inStock=true, rating passes through. ---- */
  const buildProductsQuery = (withAttrs: boolean): string => {
    const qs = new URLSearchParams();
    qs.set("page", "1");
    qs.set("pageSize", "100");
    if (q) qs.set("q", q);
    if (category) qs.set("category", category);
    if (brand) qs.set("brand", brand);
    qs.set("sort", sort);
    if (minPoisha !== undefined) qs.set("minPricePoisha", String(minPoisha));
    if (maxPoisha !== undefined) qs.set("maxPricePoisha", String(maxPoisha));
    if (inStockOnly) qs.set("inStock", "true");
    if (ratingMin !== undefined) qs.set("rating", String(ratingMin));
    if (withAttrs && attributeFilters) {
      for (const pair of attrPairs) qs.append("attr", pairToParam(pair));
    }
    return qs.toString();
  };
  const mainQuery = buildProductsQuery(true);
  // Facet scope stays PRE-attribute-filter (facets must offer the
  // sibling values of the current selection), so when the main fetch
  // carries attr params a second, unfiltered-by-attrs fetch provides
  // the facet base. Otherwise the main fetch IS the facet base.
  const facetQuery = attributeFilters ? buildProductsQuery(false) : null;

  const [result, setResult] = useState<ProductsApiResult | null>(null);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setFetching(true);
    // Filter-param changes land back at the top, like the old
    // full-page navigation did — but not on the first mount.
    if (hasLoadedOnceRef.current) {
      mainRef.current?.scrollIntoView();
    }
    void (async () => {
      const [main, facet] = await Promise.all([
        fetchProductsPage(mainQuery).catch(() => ({ products: [] as PublicProduct[], total: 0 })),
        facetQuery
          ? fetchProductsPage(facetQuery).catch(
              () => ({ products: [] as PublicProduct[], total: 0 }),
            )
          : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setResult({
        products: main.products,
        total: main.total,
        facetBase: facet ? facet.products : null,
      });
      hasLoadedOnceRef.current = true;
      setFetching(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [mainQuery, facetQuery]);

  /* ---- Category landing title: the old page set this server-side
   *  via generateMetadata; the static shell can't, so the client
   *  applies the same resolution (SEO title, Bangla first, then the
   *  category name, then the shop default) once categories land. ---- */
  useEffect(() => {
    if (!category) {
      document.title = s.shopDefaultTitle;
      return;
    }
    const cat = categories.find((c) => c.slug === category);
    document.title = cat
      ? (cat.seoTitle?.[locale] ?? cat.seoTitle?.bn ?? cat.seoTitle?.en ?? interpolate(s.categoryFallbackTitle, { name: cat.name[locale] || cat.name.bn }))
      : s.shopDefaultTitle;
  }, [category, categories, locale, s]);

  /* ---- Derived render state (same derivations as the server page) - */
  const baseProducts = result?.products ?? [];
  const products = applyLocalFilters(baseProducts, hasLocalAttrFilter ? attrPairs : []);
  // With no local filter active the API total is exact — attribute
  // filters included. With a local filter active it no longer
  // describes what's shown: the filtered count of the fetched page
  // does (see the header note about the 100-item cap). Before the
  // first response there is no honest number: null renders "…".
  const displayTotal: number | null =
    result === null ? null : hasLocalFilter ? products.length : result.total;
  const facetBaseProducts = result?.facetBase ?? baseProducts;

  const activeCategory = categories.find((c) => c.slug === category);
  const hasPriceFilter = minPoisha !== undefined || maxPoisha !== undefined;
  const hasAnyFilter = Boolean(
    category || brand || hasPriceFilter || inStockOnly || ratingMin !== undefined || attrPairs.length > 0,
  );
  const priceChipLabel = hasPriceFilter
    ? `${minPoisha !== undefined ? TakaShort(minPoisha) : s.priceZeroLabel} – ${maxPoisha !== undefined ? TakaShort(maxPoisha) : s.priceMaxLabel}`
    : null;

  // Attribute facets for the CURRENT result scope: keys come from the
  // managed attribute-set library (labels + canonical values), scoped
  // to keys/values actually present on the facet base (the
  // pre-attr-filter fetch — facetBaseProducts) — so a category only
  // offers filters its products carry, and a selected value never
  // hides its siblings.
  const presentByKey = new Map<string, Set<string>>();
  for (const p of facetBaseProducts) {
    for (const v of p.variants) {
      if (!v.isActive) continue;
      for (const [key, value] of Object.entries(v.attributes)) {
        const set = presentByKey.get(key) ?? new Set<string>();
        set.add(value);
        presentByKey.set(key, set);
      }
    }
  }
  const attrFacets = attributeSets
    .filter((set) => presentByKey.has(set.key))
    .map((set) => ({
      key: set.key,
      labelBn: set.labelBn,
      labelEn: set.labelEn,
      values: set.values.filter((value) => presentByKey.get(set.key)?.has(value)),
    }))
    .filter((facet) => facet.values.length > 0);

  const heading = q
    ? interpolate(s.searchResultsHeading, { q })
    : activeCategory
      ? activeCategory.name[locale] || activeCategory.name.bn
      : t.allProducts;

  const attrLabel = (pair: AttrPair): string => {
    const set = attributeSets.find((s) => s.key === pair.key);
    const setLabel = set ? (locale === "bn" ? set.labelBn : set.labelEn || set.labelBn) : pair.key;
    return `${setLabel}: ${pair.value}`;
  };

  const activeChips: Array<{ key: string; label: string; href: string }> = [];
  if (q) activeChips.push({ key: "q", label: interpolate(s.searchChip, { q }), href: buildHref(current, { q: undefined }) });
  if (activeCategory)
    activeChips.push({ key: "category", label: activeCategory.name[locale] || activeCategory.name.bn, href: buildHref(current, { category: undefined }) });
  if (brand) activeChips.push({ key: "brand", label: brand, href: buildHref(current, { brand: undefined }) });
  if (priceChipLabel)
    activeChips.push({ key: "price", label: priceChipLabel, href: buildHref(current, { min: undefined, max: undefined }) });
  if (inStockOnly)
    activeChips.push({ key: "instock", label: s.inStockOnlyChip, href: buildHref(current, { instock: undefined }) });
  if (ratingMin !== undefined)
    activeChips.push({ key: "rating", label: interpolate(s.ratingChip, { rating: ratingMin }), href: buildHref(current, { rating: undefined }) });
  for (const pair of attrPairs) {
    activeChips.push({
      key: `attr-${pairToParam(pair)}`,
      label: attrLabel(pair),
      href: toggleAttr(current, pair),
    });
  }

  // Results / loading / empty states — this block stays ShopBrowser's
  // (it is the state owner's render output) and is handed to the
  // ShopChrome slot as its children, rendered inside the chrome's
  // results section exactly where it sat inline before S3b.
  const resultsBlock =
    result === null ? (
      <div
        className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4 xl:gap-5"
        aria-label={t.loading}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <ShopCardSkeleton key={i} />
        ))}
      </div>
    ) : products.length === 0 ? (
      <div className="mt-6">
        {q ? (
          <EmptyState
            title={interpolate(s.emptySearchTitle, { q })}
            description={s.emptySearchDescription}
            ctaHref="/shop"
            ctaLabel={s.emptySearchCta}
          />
        ) : hasAnyFilter ? (
          <EmptyState
            title={s.emptyFilterTitle}
            description={s.emptyFilterDescription}
            ctaHref="/shop"
            ctaLabel={s.emptyFilterCta}
          />
        ) : (
          <EmptyState
            title={s.emptyCatalogTitle}
            description={s.emptyCatalogDescription}
            ctaHref="/"
            ctaLabel={s.emptyCatalogCta}
          />
        )}
      </div>
    ) : (
      <div
        className={`mt-6 grid grid-cols-2 gap-3 transition-opacity duration-200 sm:gap-4 md:grid-cols-3 xl:grid-cols-4 xl:gap-5 ${
          fetching ? "opacity-50" : ""
        }`}
      >
        {products.map((p) => (
          <ThemedProductCard key={p.id} product={p} />
        ))}
      </div>
    );

  // ShopChrome slot (S3b): the sidebar + toolbar composition is the
  // active package's chrome, resolved through the client-safe shop
  // registry from the ThemeView context — same S3a pattern as the
  // shell's Header/Footer. Every value below is derived by this
  // component exactly as the inline JSX consumed it; the chrome only
  // arranges the markup.
  const chromeProps: ShopChromeProps = {
    breadcrumbCategoryLabel: activeCategory ? activeCategory.name[locale] || activeCategory.name.bn : null,
    heading,
    displayTotal,
    filtersApplied: hasAnyFilter || Boolean(q),
    resultCount: displayTotal ?? 0,
    clearHref: hasAnyFilter || q ? "/shop" : undefined,
    sort,
    onSortChange: (value: string) => router.push(buildHref(current, { sort: value })),
    chips: activeChips,
    busy: result === null || fetching,
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
    children: resultsBlock,
  };

  return (
    <main ref={mainRef} className="mx-auto min-w-0 max-w-[1440px] px-4 py-6 sm:px-6 lg:py-8">
      <ThemeBoundary
        slotName="ShopChrome"
        packageId={themeView.packageId}
        fallback={<AURORA_SHOP_CHROME {...chromeProps} />}
      >
        <ShopChrome {...chromeProps} />
      </ThemeBoundary>
    </main>
  );
}
