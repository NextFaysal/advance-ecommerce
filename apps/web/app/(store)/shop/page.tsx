import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ProductCard } from "@/catalog/ProductCard";
import type { SortOption } from "@/catalog/search";
import { listCategories, listPublicProducts } from "@/catalog/server-read";

// Data: real catalog DB (ACTIVE products only) via the Prisma
// repository — the same filter contract as GET /api/v1/public/products.
// An empty DB renders the honest empty state below, never mock data.
// Design refresh (Direction A): filter sidebar + toolbar + designed
// empty states. All filtering stays server-driven via the SAME query
// params as before (category, brand, sort, min, max, instock, q), so
// links remain shareable/SEO-friendly and no behaviour changed.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "দোকান — Advance Ecommerce",
  description: "সব পণ্য — ফিল্টার, সর্ট ও সার্চ দিয়ে খুঁজুন।",
};

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

interface ShopParams {
  category?: string;
  brand?: string;
  sort?: string;
  min?: string;
  max?: string;
  instock?: string;
  q?: string;
}

/** Merge current params with overrides (undefined clears a key). */
function buildHref(current: ShopParams, overrides: Partial<ShopParams>): string {
  const merged: ShopParams = { ...current, ...overrides };
  const qs = new URLSearchParams();
  (Object.keys(merged) as Array<keyof ShopParams>).forEach((key) => {
    const value = merged[key];
    if (value !== undefined && value !== "") qs.set(key, value);
  });
  const query = qs.toString();
  return query ? `/shop?${query}` : "/shop";
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
    <details open={defaultOpen} className="group border-b border-border py-4 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold text-text-main [&::-webkit-details-marker]:hidden">
        {title}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="text-text-subtle transition group-open:rotate-180"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <div className="mt-3 space-y-1">{children}</div>
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
      className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition ${
        active
          ? "bg-brand-50 font-semibold text-brand-700"
          : "text-text-muted hover:bg-surface-2 hover:text-text-main"
      }`}
    >
      <span className="min-w-0 truncate">{children}</span>
      {count !== undefined ? <span className="ml-2 shrink-0 text-xs text-text-subtle">{count}</span> : null}
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
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-500">
        <svg
          width="30"
          height="30"
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
      <h2 className="mt-4 text-lg font-bold text-text-main">{title}</h2>
      <p className="mt-1.5 max-w-md break-words text-sm leading-6 text-text-muted [overflow-wrap:anywhere]">
        {description}
      </p>
      <Link
        href={ctaHref}
        className="brand-gradient mt-5 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
      >
        {ctaLabel}
      </Link>
    </div>
  );
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: { category?: string | string[]; brand?: string | string[]; sort?: string | string[]; min?: string | string[]; max?: string | string[]; instock?: string | string[]; q?: string | string[] };
}) {
  const current: ShopParams = {
    category: first(searchParams.category),
    brand: first(searchParams.brand),
    sort: first(searchParams.sort),
    min: first(searchParams.min),
    max: first(searchParams.max),
    instock: first(searchParams.instock),
    q: first(searchParams.q),
  };
  const { category, brand, q } = current;
  const sort = parseSort(searchParams.sort);
  const minPoisha = parsePoisha(searchParams.min);
  const maxPoisha = parsePoisha(searchParams.max);
  const inStockOnly = searchParams.instock === "1";

  // PUBLIC shape only (listPublicProducts strips costPoisha): the full
  // repository Product must never reach ProductCard's serialized props.
  const [result, categories] = await Promise.all([
    listPublicProducts({
      query: q,
      categorySlug: category,
      brandName: brand,
      sort,
      minPricePoisha: minPoisha,
      maxPricePoisha: maxPoisha,
      inStockOnly,
      page: 1,
      pageSize: 100,
    }),
    listCategories(),
  ]);
  const products = result.products;

  const activeCategory = categories.find((c) => c.slug === category);
  // Brand facets: derived from the current result set (no separate
  // brand-list endpoint exists); hidden entirely when no brand data.
  const brands = Array.from(new Set(products.map((p) => p.brandName).filter((b): b is string => Boolean(b)))).sort();
  const hasPriceFilter = minPoisha !== undefined || maxPoisha !== undefined;
  const hasAnyFilter = Boolean(category || brand || hasPriceFilter || inStockOnly);
  const priceChipLabel = hasPriceFilter
    ? `${minPoisha !== undefined ? TakaShort(minPoisha) : "৳০"} – ${maxPoisha !== undefined ? TakaShort(maxPoisha) : "সর্বোচ্চ"}`
    : null;

  const heading = q
    ? `“${q}” — অনুসন্ধানের ফলাফল`
    : activeCategory
      ? activeCategory.name.bn
      : "সব পণ্য";

  const activeChips: Array<{ key: string; label: string; href: string }> = [];
  if (q) activeChips.push({ key: "q", label: `খোঁজ: ${q}`, href: buildHref(current, { q: undefined }) });
  if (activeCategory)
    activeChips.push({ key: "category", label: activeCategory.name.bn, href: buildHref(current, { category: undefined }) });
  if (brand) activeChips.push({ key: "brand", label: brand, href: buildHref(current, { brand: undefined }) });
  if (priceChipLabel)
    activeChips.push({ key: "price", label: priceChipLabel, href: buildHref(current, { min: undefined, max: undefined }) });
  if (inStockOnly)
    activeChips.push({ key: "instock", label: "শুধু স্টকে আছে", href: buildHref(current, { instock: undefined }) });

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

      <div className="mt-4 grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* ---------- Filter sidebar ---------- */}
        <aside className="min-w-0">
          <div className="rounded-2xl border border-border bg-card px-4 py-1 shadow-sm lg:sticky lg:top-24">
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
                  <SidebarLink key={b} href={buildHref(current, { brand: b })} active={brand === b}>
                    {b}
                  </SidebarLink>
                ))}
              </FilterSection>
            ) : null}

            <FilterSection title="প্রাপ্যতা">
              <SidebarLink href={buildHref(current, { instock: undefined })} active={!inStockOnly}>
                সব পণ্য
              </SidebarLink>
              <SidebarLink href={buildHref(current, { instock: "1" })} active={inStockOnly}>
                শুধু স্টকে আছে
              </SidebarLink>
            </FilterSection>
          </div>
        </aside>

        {/* ---------- Results ---------- */}
        <section className="min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="break-words text-2xl font-extrabold text-text-main [overflow-wrap:anywhere]">{heading}</h1>
              <p className="mt-1 text-sm text-text-muted">
                মোট {result.total}টি পণ্য
                {hasAnyFilter || q ? " — ফিল্টার প্রয়োগ করা হয়েছে" : ""}
              </p>
            </div>

            {/* Sort — plain GET form, same `sort` param as before */}
            <form method="get" action="/shop" className="flex items-center gap-2">
              {current.category ? <input type="hidden" name="category" value={current.category} /> : null}
              {current.brand ? <input type="hidden" name="brand" value={current.brand} /> : null}
              {current.min ? <input type="hidden" name="min" value={current.min} /> : null}
              {current.max ? <input type="hidden" name="max" value={current.max} /> : null}
              {current.instock ? <input type="hidden" name="instock" value={current.instock} /> : null}
              {current.q ? <input type="hidden" name="q" value={current.q} /> : null}
              <label htmlFor="shop-sort" className="text-sm text-text-muted">
                সাজান:
              </label>
              <select
                id="shop-sort"
                name="sort"
                defaultValue={sort}
                className="h-10 rounded-[10px] border border-border bg-card px-2.5 text-sm text-text-main outline-none focus:border-brand-500"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="h-10 rounded-[10px] bg-brand-600 px-3.5 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                প্রয়োগ
              </button>
            </form>
          </div>

          {/* Active filter chips */}
          {activeChips.length > 0 ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {activeChips.map((chip) => (
                <Link
                  key={chip.key}
                  href={chip.href}
                  aria-label={`${chip.label} ফিল্টার সরান`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 py-1.5 pl-3.5 pr-2.5 text-[13px] font-medium text-brand-700 transition hover:bg-brand-100"
                >
                  {chip.label}
                  <span aria-hidden="true" className="text-base leading-none">×</span>
                </Link>
              ))}
              <Link href="/shop" className="text-[13px] font-semibold text-text-muted underline-offset-2 hover:text-brand-700 hover:underline">
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
            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
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
