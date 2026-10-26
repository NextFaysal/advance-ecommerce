import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ProductCard } from "@/catalog/ProductCard";
import type { SortOption } from "@/catalog/search";
import { findPublicCategoryBySlug } from "@/catalog/category-tree";
import { listCategories, listPublicProducts } from "@/catalog/server-read";
import { listPublicBrands, type PublicBrand } from "@/catalog/public-brands";
import { listAttributeSetsAdmin, type AdminAttributeSet } from "@/catalog/attributes-admin";
import type { PublicProduct } from "@/catalog/types";
import { cached } from "@/lib/ttl-cache";
import { MobileFilterDrawer } from "./MobileFilterDrawer";

// Data: real catalog DB (ACTIVE products only) via the Prisma
// repository — the same filter contract as GET /api/v1/public/products.
// An empty DB renders the honest empty state below, never mock data.
// Design refresh (Direction A): filter sidebar + toolbar + designed
// empty states. Filtering stays server-driven via shareable GET params
// (category, brand, sort, min, max, instock, q, rating, attr).
//
// Wave 14-2 additions:
// - The brand facet comes from GET /api/v1/public/brands' helper
//   (listPublicBrands) — brands with ≥1 ACTIVE product — NOT from the
//   current result set, so facets no longer vanish under other filters.
// - Attribute facets are scoped to the PRE-attribute-filter result
//   set (a second fetch without attributeFilters, below), so
//   selecting a value never hides its sibling values.
//
// Filter exactness (Wave 16-1) — what the displayed total covers:
// - Category, brand, price, stock, query AND attribute filters are
//   EXACT: the repository evaluates them in its SQL where + count,
//   so "মোট Nটি পণ্য" is a catalogue-wide count. Attribute filters
//   ride ProductFilter.attributeFilters with the repository's
//   single-variant semantics (ONE active variant must carry every
//   selected pair — the same rule as the public API), whenever the
//   selection is expressible in that Record<key, value> contract:
//   at most one selected value per attribute key.
// - Rating is EXACT too (wave-16 parent fix): ratingMin rides the
//   repository filter and lands on the maintained Product.
//   ratingAverage column as a SQL { gte } clause, so its total is
//   catalogue-wide like the rest.
// - One case still filters IN-PAGE over the fetched page (capped at
//   pageSize 100); with it active, the displayed total is the
//   filtered count WITHIN that page, not a catalogue-wide count:
//   attribute selections with MULTIPLE values for one key — the
//   Record<key, value> contract holds one value per key, so
//   OR-within-a-key matching stays local, exactly as before.
export const dynamic = "force-dynamic";

const SHOP_DEFAULT_TITLE = "দোকান — Advance Ecommerce";
const SHOP_DEFAULT_DESCRIPTION = "সব পণ্য — ফিল্টার, সর্ট ও সার্চ দিয়ে খুঁজুন।";

// Category landing metadata (Wave 13-2): /shop?category=<slug> IS the
// category landing page, so its metadata comes from the category's
// SEO fields (Admin → ক্যাটাগরি → SEO) when set — Bangla first, like
// the PDP — falling back to the category name, then to the generic
// shop metadata. A failed lookup never breaks the page: defaults win.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: { category?: string | string[] };
}): Promise<Metadata> {
  const slug = first(searchParams.category);
  if (!slug) return { title: SHOP_DEFAULT_TITLE, description: SHOP_DEFAULT_DESCRIPTION };
  const category = await findPublicCategoryBySlug(slug);
  if (!category) return { title: SHOP_DEFAULT_TITLE, description: SHOP_DEFAULT_DESCRIPTION };
  const title = category.seoTitle?.bn ?? category.seoTitle?.en ?? `${category.name.bn} — Advance Ecommerce`;
  const description =
    category.seoDescription?.bn ?? category.seoDescription?.en ?? SHOP_DEFAULT_DESCRIPTION;
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
  };
}

// SearchParams are strings in App Router; parse defensively, never trust the client.
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

function TakaShort(poisha: number): string {
  return `৳${(poisha / 100).toLocaleString("en-IN")}`;
}

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
      className={`flex min-h-[40px] items-center justify-between rounded-xl px-3 py-2 text-sm transition duration-200 ${
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
      className={`flex min-h-[40px] items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition duration-200 ${
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

/** In-page predicates for the one filter case the repository cannot
 *  take (see the header's exactness note): attribute pairs only when
 *  the caller passes them — i.e. the multi-value-per-key case.
 *  Server-expressible attribute filters and the rating floor are NOT
 *  passed here; the repository already applied them. */
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

interface ShopSearchParams {
  category?: string | string[];
  brand?: string | string[];
  sort?: string | string[];
  min?: string | string[];
  max?: string | string[];
  instock?: string | string[];
  q?: string | string[];
  rating?: string | string[];
  attr?: string | string[];
}

export default async function ShopPage({ searchParams }: { searchParams: ShopSearchParams }) {
  const attrPairs = parseAttrs(searchParams.attr);
  const current: ShopState = {
    category: first(searchParams.category),
    brand: first(searchParams.brand),
    sort: first(searchParams.sort),
    min: first(searchParams.min),
    max: first(searchParams.max),
    instock: first(searchParams.instock),
    q: first(searchParams.q),
    rating: first(searchParams.rating),
    attr: attrPairs.map(pairToParam),
  };
  const { category, brand, q } = current;
  const sort = parseSort(searchParams.sort);
  const minPoisha = parsePoisha(searchParams.min);
  const maxPoisha = parsePoisha(searchParams.max);
  const inStockOnly = searchParams.instock === "1";
  const ratingMin = parseRating(searchParams.rating);

  // Wave 16-1: attribute filters go to the REPOSITORY (exact totals)
  // when the selection fits its Record<key, value> contract — at
  // most one selected value per key. Multiple values for one key
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
  // the repository total — see the header note. Rating rides the
  // repository filter (shopFilter.ratingMin) and stays exact.
  const hasLocalFilter = hasLocalAttrFilter;

  // PUBLIC shape only (listPublicProducts strips costPoisha): the full
  // repository Product must never reach ProductCard's serialized props.
  // Brands + attribute sets degrade to empty (facet hidden) on failure —
  // a facet outage must never take the shop down.
  const shopFilter = {
    query: q,
    categorySlug: category,
    brandName: brand,
    sort,
    minPricePoisha: minPoisha,
    maxPricePoisha: maxPoisha,
    inStockOnly,
    ratingMin,
    page: 1,
    pageSize: 100,
  };
  const [result, facetResult, categories, brands, attributeSets] = await Promise.all([
    listPublicProducts({ ...shopFilter, attributeFilters }),
    // Facet scope stays PRE-attribute-filter (facets must offer the
    // sibling values of the current selection), so when the main
    // fetch carries attributeFilters a second, unfiltered-by-attrs
    // fetch provides the facet base. Otherwise the main fetch IS
    // the facet base and no second call happens.
    attributeFilters ? listPublicProducts(shopFilter) : Promise.resolve(null),
    listCategories(),
    // Speed wave batch 2: the facet libraries (brands, attribute
    // sets) change only on admin edits — serve them through a 60s
    // in-process TTL instead of raw DB queries on every render.
    cached("shop:brands", 60_000, () => listPublicBrands()).catch((): PublicBrand[] => []),
    cached("shop:attribute-sets", 60_000, () => listAttributeSetsAdmin()).catch(
      (): AdminAttributeSet[] => [],
    ),
  ]);
  const baseProducts = result.products;
  const products = applyLocalFilters(baseProducts, hasLocalAttrFilter ? attrPairs : []);
  // With no local filter active the repository total is exact —
  // attribute filters included. With a local filter active it no
  // longer describes what's shown: the filtered count of the
  // fetched page does (see the header note about the 100-item cap).
  const displayTotal = hasLocalFilter ? products.length : result.total;
  const facetBaseProducts = facetResult ? facetResult.products : baseProducts;

  const activeCategory = categories.find((c) => c.slug === category);
  const hasPriceFilter = minPoisha !== undefined || maxPoisha !== undefined;
  const hasAnyFilter = Boolean(
    category || brand || hasPriceFilter || inStockOnly || ratingMin !== undefined || attrPairs.length > 0,
  );
  const priceChipLabel = hasPriceFilter
    ? `${minPoisha !== undefined ? TakaShort(minPoisha) : "৳০"} – ${maxPoisha !== undefined ? TakaShort(maxPoisha) : "সর্বোচ্চ"}`
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
      values: set.values.filter((value) => presentByKey.get(set.key)?.has(value)),
    }))
    .filter((facet) => facet.values.length > 0);

  const heading = q
    ? `“${q}” — অনুসন্ধানের ফলাফল`
    : activeCategory
      ? activeCategory.name.bn
      : "সব পণ্য";

  const attrLabel = (pair: AttrPair): string => {
    const set = attributeSets.find((s) => s.key === pair.key);
    return `${set?.labelBn ?? pair.key}: ${pair.value}`;
  };

  const activeChips: Array<{ key: string; label: string; href: string }> = [];
  if (q) activeChips.push({ key: "q", label: `খোঁজ: ${q}`, href: buildHref(current, { q: undefined }) });
  if (activeCategory)
    activeChips.push({ key: "category", label: activeCategory.name.bn, href: buildHref(current, { category: undefined }) });
  if (brand) activeChips.push({ key: "brand", label: brand, href: buildHref(current, { brand: undefined }) });
  if (priceChipLabel)
    activeChips.push({ key: "price", label: priceChipLabel, href: buildHref(current, { min: undefined, max: undefined }) });
  if (inStockOnly)
    activeChips.push({ key: "instock", label: "শুধু স্টকে আছে", href: buildHref(current, { instock: undefined }) });
  if (ratingMin !== undefined)
    activeChips.push({ key: "rating", label: `${ratingMin}★ ও উপরে`, href: buildHref(current, { rating: undefined }) });
  for (const pair of attrPairs) {
    activeChips.push({
      key: `attr-${pairToParam(pair)}`,
      label: attrLabel(pair),
      href: toggleAttr(current, pair),
    });
  }

  // Filter panel content — rendered ONCE as a node, then placed in the
  // desktop sidebar card and (Design v3) inside the mobile filter
  // drawer. Same GET-param links in both, so behaviour is identical.
  const filterPanel = (
    <>
      <FilterSection title="ক্যাটাগরি">
        <SidebarLink href={buildHref(current, { category: undefined })} active={!category}>
          সব ক্যাটাগরি
        </SidebarLink>
        {categories.map((c) => (
          <SidebarLink
            key={c.slug}
            href={buildHref(current, { category: c.slug })}
            active={category === c.slug}
            count={c.productCount}
          >
            {c.name.bn}
          </SidebarLink>
        ))}
      </FilterSection>

      <FilterSection title="মূল্য">
        <SidebarLink href={buildHref(current, { min: undefined, max: undefined })} active={!hasPriceFilter}>
          সব দাম
        </SidebarLink>
        {PRICE_RANGES.map((range) => {
          const active = minPoisha === range.min && maxPoisha === range.max && hasPriceFilter;
          return (
            <SidebarLink
              key={range.label}
              href={buildHref(current, {
                min: range.min !== undefined ? String(range.min) : undefined,
                max: range.max !== undefined ? String(range.max) : undefined,
              })}
              active={active}
            >
              {range.label}
            </SidebarLink>
          );
        })}
      </FilterSection>

      {brands.length > 0 ? (
        <FilterSection title="ব্র্যান্ড">
          <SidebarLink href={buildHref(current, { brand: undefined })} active={!brand}>
            সব ব্র্যান্ড
          </SidebarLink>
          {brands.map((b) => (
            <SidebarLink key={b.slug} href={buildHref(current, { brand: b.name })} active={brand === b.name} count={b.productCount}>
              {b.name}
            </SidebarLink>
          ))}
        </FilterSection>
      ) : null}

      <FilterSection title="রেটিং">
        {RATING_OPTIONS.map((option) => (
          <SidebarLink
            key={option.label}
            href={buildHref(current, { rating: option.value !== undefined ? String(option.value) : undefined })}
            active={ratingMin === option.value}
          >
            {option.label}
          </SidebarLink>
        ))}
      </FilterSection>

      {attrFacets.map((facet) => (
        <FilterSection key={facet.key} title={facet.labelBn}>
          {facet.values.map((value) => {
            const pair = { key: facet.key, value };
            const active = current.attr.includes(pairToParam(pair));
            return (
              <AttrToggleLink key={value} href={toggleAttr(current, pair)} active={active}>
                {value}
              </AttrToggleLink>
            );
          })}
        </FilterSection>
      ))}

      <FilterSection title="প্রাপ্যতা">
        <SidebarLink href={buildHref(current, { instock: undefined })} active={!inStockOnly}>
          সব পণ্য
        </SidebarLink>
        <SidebarLink href={buildHref(current, { instock: "1" })} active={inStockOnly}>
          শুধু স্টকে আছে
        </SidebarLink>
      </FilterSection>
    </>
  );

  return (
    <main className="mx-auto min-w-0 max-w-[1440px] px-4 py-6 sm:px-6 lg:py-8">
      {/* Breadcrumb */}
      <nav aria-label="ব্রেডক্রাম্ব" className="flex flex-wrap items-center gap-1.5 text-sm text-text-subtle">
        <Link href="/" className="hover:text-brand-700">হোম</Link>
        <span aria-hidden="true">/</span>
        <Link href="/shop" className="hover:text-brand-700">দোকান</Link>
        {activeCategory ? (
          <>
            <span aria-hidden="true">/</span>
            <span className="font-medium text-text-main">{activeCategory.name.bn}</span>
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
        <section className="min-w-0">
          {/* Toolbar — Wave 17: on mobile this is a sticky glass bar
              pinned under the h-16 site header (top-16) carrying the
              heading, result count, filter drawer trigger and sort;
              on lg it relaxes back into a plain static header row. */}
          <div className="sticky top-16 z-30 -mx-4 border-b border-border/60 bg-bg-app/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-b-0 lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-none">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5">
              <div className="min-w-0">
                <h1 className="break-words font-display text-h1 text-text-main [overflow-wrap:anywhere]">{heading}</h1>
                <p className="mt-0.5 text-sm text-text-muted">
                  মোট {displayTotal}টি পণ্য
                  {hasAnyFilter || q ? " — ফিল্টার প্রয়োগ করা হয়েছে" : ""}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {/* Mobile filter trigger (Design v3) — the drawer lives
                    here now so it stays reachable inside the sticky bar. */}
                <div className="flex flex-wrap items-center gap-2.5 lg:hidden">
                  <MobileFilterDrawer
                    resultCount={displayTotal}
                    clearHref={hasAnyFilter || q ? "/shop" : undefined}
                  >
                    {filterPanel}
                  </MobileFilterDrawer>
                  {activeChips.length > 0 ? (
                    <span className="rounded-full bg-brand-500/10 px-2.5 py-1 text-[13px] font-semibold text-brand-700 dark:text-brand-200">
                      {activeChips.length}টি ফিল্টার সক্রিয়
                    </span>
                  ) : null}
                </div>

                {/* Sort — plain GET form, same `sort` param as before;
                    every other active filter rides along as hidden inputs */}
                <form method="get" action="/shop" className="flex flex-wrap items-center gap-2">
                  {current.category ? <input type="hidden" name="category" value={current.category} /> : null}
                  {current.brand ? <input type="hidden" name="brand" value={current.brand} /> : null}
                  {current.min ? <input type="hidden" name="min" value={current.min} /> : null}
                  {current.max ? <input type="hidden" name="max" value={current.max} /> : null}
                  {current.instock ? <input type="hidden" name="instock" value={current.instock} /> : null}
                  {current.q ? <input type="hidden" name="q" value={current.q} /> : null}
                  {current.rating ? <input type="hidden" name="rating" value={current.rating} /> : null}
                  {current.attr.map((entry) => (
                    <input key={entry} type="hidden" name="attr" value={entry} />
                  ))}
                  <label htmlFor="shop-sort" className="hidden text-sm text-text-muted min-[420px]:block">
                    সাজান:
                  </label>
                  <select
                    id="shop-sort"
                    name="sort"
                    defaultValue={sort}
                    className="h-11 rounded-xl border border-border bg-card px-2.5 text-sm text-text-main shadow-sm outline-none transition focus:border-brand-500"
                  >
                    {SORT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-brand-700 active:scale-[0.98]"
                  >
                    প্রয়োগ
                  </button>
                </form>
              </div>
            </div>
          </div>

          {/* Active filter chips */}
          {activeChips.length > 0 ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {activeChips.map((chip) => (
                <Link
                  key={chip.key}
                  href={chip.href}
                  aria-label={`${chip.label} ফিল্টার সরান`}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-brand-600/15 bg-brand-500/10 py-1.5 pl-3.5 pr-2 text-[13px] font-medium text-brand-700 transition duration-200 hover:bg-brand-500/20 active:scale-[0.97] dark:text-brand-200"
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
              <Link href="/shop" className="inline-flex min-h-[36px] items-center px-1 text-[13px] font-semibold text-text-muted underline-offset-2 transition hover:text-brand-700 hover:underline dark:hover:text-brand-300">
                সব ফিল্টার মুছুন
              </Link>
            </div>
          ) : null}

          {/* Results / empty states */}
          {products.length === 0 ? (
            <div className="mt-6">
              {q ? (
                <EmptyState
                  title={`“${q}” দিয়ে কোনো পণ্য পাওয়া যায়নি`}
                  description="বানান ঠিক আছে কিনা দেখুন, অথবা অন্য কোনো নামে খুঁজে দেখুন। চাইলে সব পণ্য ঘুরে দেখতে পারেন।"
                  ctaHref="/shop"
                  ctaLabel="সব পণ্য দেখুন"
                />
              ) : hasAnyFilter ? (
                <EmptyState
                  title="এই ফিল্টারে কোনো পণ্য মিলছে না"
                  description="নির্বাচিত ফিল্টারের সাথে মিলে এমন পণ্য এখন স্টকে নেই। ফিল্টার বদলে বা মুছে আবার দেখুন।"
                  ctaHref="/shop"
                  ctaLabel="সব ফিল্টার মুছুন"
                />
              ) : (
                <EmptyState
                  title="এখনো কোনো পণ্য যোগ হয়নি"
                  description="আমাদের কালেকশন তৈরি হচ্ছে — খুব শীঘ্রই নতুন পণ্য আসছে। ততক্ষণে হোমপেজে ঘুরে দেখুন।"
                  ctaHref="/"
                  ctaLabel="হোমপেজে যান"
                />
              )}
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4 xl:gap-5">
              {products.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
