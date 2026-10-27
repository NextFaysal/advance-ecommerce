/**
 * Shobji HomeSections slot — doc 27 theme T-B.
 *
 * The sidebar-grocery home composition, built ONLY from the data
 * the home page passes in (HomeSectionsProps — the same fetch
 * every package receives):
 *
 *   [ LEFT category sidebar | hero → hero stats → 4 USP cards →
 *     category tiles → featured rail → brands → category rails →
 *     banner (3rd CMS slide) → closing grid + LOAD MORE →
 *     testimonials ]
 *
 * The sidebar is this package's signature: real categories from
 * props with real /shop?category= links (category-sidebar.tsx).
 * It renders on desktop only (CSS) and collapses to the header's
 * horizontal scroll strip on mobile. The `showSidebar` option is
 * read inside the sidebar island (a client component — this
 * server composition cannot read the ThemeView context): when the
 * option is off the island returns null, the wrapping flex row
 * simply has one child, and the content takes the full width.
 *
 * Aurora-only mechanics (flash countdown, spin wheel, social-proof
 * ticker, why-us band, newsletter) do NOT render here. The one
 * invisible exception is VisitorIdBootstrap: it renders nothing
 * and only keeps the platform's marketing-mechanics bootstrap
 * running under this theme, gated by the same flag.
 *
 * Honest-data rules, enforced by construction:
 * - Category rails group the fetched products by their REAL
 *   `categorySlug` (PublicProduct carries it). A rail renders only
 *   for a category that actually has fetched products; membership
 *   is never invented. The page fetches a flat featured list (8
 *   products), so rails are necessarily thin — the closing grid
 *   always carries the full list + LOAD MORE.
 * - "Our Brands" derives from the products' real `brandName`
 *   values (no brand-logo assets exist; tiles are text tiles).
 * - Testimonials are the real approved homepage reviews.
 * - No sales counts, ranks or ratings are fabricated anywhere.
 */
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { VisitorIdBootstrap } from "@/marketing/components/VisitorIdBootstrap";
import { ThemedProductCard } from "../themed-product-card";
import type { HomeSectionsProps } from "../slots";
import ShobjiCategorySidebar from "./category-sidebar";
import ShobjiHomeHero from "./home-hero";
import ShobjiHomeCategories from "./home-categories";
import ShobjiHomeTopSelling from "./home-top-selling";
import ShobjiHomeBrands from "./home-brands";
import ShobjiHomeTestimonials from "./home-testimonials";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { SHOBJI_STRINGS, type ShobjiStrings } from "./strings";

/* Our own generic service points (icon + line), drawn from the
   platform's real storefront promises — COD, home delivery, easy
   returns, verified quality. Copy is ours (doc 27 T-B's 4 USPs). */
function uspItems(s: ShobjiStrings) {
  return [
    { icon: "banknote", title: s.uspCodTitle, text: s.uspCodText },
    { icon: "truck", title: s.uspDeliveryTitle, text: s.uspDeliveryText },
    { icon: "rotate-ccw", title: s.uspReturnTitle, text: s.uspReturnText },
    { icon: "shield", title: s.uspQualityTitle, text: s.uspQualityText },
  ] as const;
}

/** Rail section heading: title left with a short purple underline,
 *  "সব দেখুন →" right. */
function RailHeading({ title, href, s }: { title: string; href: string; s: ShobjiStrings }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-xl font-extrabold text-text-main sm:text-2xl">{title}</h2>
        <span aria-hidden="true" className="mt-1.5 block h-[3px] w-10 rounded-full bg-primary" />
      </div>
      <Link href={href} className="shrink-0 text-sm font-bold text-primary hover:underline">
        {s.viewAllArrow}
      </Link>
    </div>
  );
}

export default async function ShobjiHomeSections({
  products,
  categories,
  heroSlides,
  customerReviews,
  mechanicsOn,
  heroStats,
}: HomeSectionsProps) {
  const s = pick(await getRequestLocale(), SHOBJI_STRINGS);
  const USP_ITEMS = uspItems(s);
  // Per-category rails from the REAL categorySlug on each fetched
  // product; categories keep the catalog's own order, capped at 3.
  const byCategory = new Map<string, typeof products>();
  for (const p of products) {
    const list = byCategory.get(p.categorySlug);
    if (list) list.push(p);
    else byCategory.set(p.categorySlug, [p]);
  }
  const rails = categories
    .filter((c) => (byCategory.get(c.slug)?.length ?? 0) > 0)
    .slice(0, 3)
    .map((c) => ({ category: c, items: byCategory.get(c.slug)! }));

  // Our Brands: distinct real brand names on the fetched products.
  const brands = Array.from(
    new Set(products.map((p) => p.brandName).filter((b): b is string => Boolean(b))),
  );

  // Full-width banner slot: a third CMS slide, when the merchant
  // has one, sits between the rails and the closing grid.
  const bannerSlide = heroSlides.length >= 3 ? heroSlides[2]! : null;

  return (
    <main className="mx-auto min-w-0 max-w-[1440px] px-4 sm:px-6">
      {/* Invisible mechanics bootstrap (renders nothing) — parity
          with the other packages' mount, same flag gate. */}
      {mechanicsOn ? <VisitorIdBootstrap /> : null}

      <div className="flex items-start gap-5">
        {/* ---------- LEFT: persistent category sidebar ---------- */}
        <ShobjiCategorySidebar
          categories={categories.map((c) => ({
            slug: c.slug,
            nameBn: c.name.bn,
            productCount: c.productCount,
          }))}
        />

        {/* ---------- RIGHT: the content column ---------- */}
        <div className="min-w-0 flex-1">
          {/* ---------- Hero: lavender panel + big search ---------- */}
          <ShobjiHomeHero slides={heroSlides} firstCategory={categories[0] ?? null} />
          {heroStats ? <div className="mt-4">{heroStats}</div> : null}

          {/* ---------- 4 USP cards (our own copy) ---------- */}
          <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={s.benefitsAria}>
            {USP_ITEMS.map((item) => (
              <div
                key={item.title}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 shadow-card"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                  <Icon name={item.icon} size={22} />
                </span>
                <span className="min-w-0">
                  <span className="block break-words text-sm font-bold leading-snug text-text-main">
                    {item.title}
                  </span>
                  <span className="mt-0.5 hidden break-words text-xs leading-5 text-text-muted sm:block">
                    {item.text}
                  </span>
                </span>
              </div>
            ))}
          </section>

          {/* ---------- Popular category tiles ---------- */}
          <ShobjiHomeCategories categories={categories} />

          {/* ---------- Featured rail (the store's featured list) ---------- */}
          <ShobjiHomeTopSelling products={products} />

          {/* ---------- Our Brands (real brand names only) ---------- */}
          <ShobjiHomeBrands brands={brands} />

          {/* ---------- Category rails (real membership only) ---------- */}
          {rails.map(({ category, items }) => (
            <section key={category.slug} className="mt-12" aria-label={category.name.bn}>
              <RailHeading s={s} title={category.name.bn} href={`/shop?category=${category.slug}`} />
              <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4">
                {items.map((p) => (
                  <ThemedProductCard key={p.id} product={p} />
                ))}
              </div>
            </section>
          ))}

          {/* ---------- Full-width banner (third CMS slide, if any) ---------- */}
          {bannerSlide ? (
            <section className="mt-12" aria-label={bannerSlide.headlineBn}>
              <Link
                href={bannerSlide.ctaHref || "/shop"}
                className="relative block min-h-[160px] overflow-hidden rounded-2xl shadow-card sm:min-h-[200px]"
              >
                {bannerSlide.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={bannerSlide.imageUrl}
                    alt={bannerSlide.headlineBn}
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <span aria-hidden="true" className="brand-soft-gradient absolute inset-0" />
                )}
                <span
                  aria-hidden="true"
                  className={`absolute inset-0 ${bannerSlide.imageUrl ? "bg-gradient-to-r from-black/55 via-black/15 to-transparent" : ""}`}
                />
                <span className="absolute inset-y-0 left-0 flex max-w-lg flex-col justify-center p-5 sm:p-8">
                  <span
                    className={`font-display text-xl font-extrabold leading-snug sm:text-2xl ${
                      bannerSlide.imageUrl ? "text-white" : "text-text-main"
                    }`}
                  >
                    {bannerSlide.headlineBn}
                  </span>
                  {bannerSlide.subtextBn ? (
                    <span
                      className={`mt-1 text-sm leading-6 ${bannerSlide.imageUrl ? "text-white/85" : "text-text-muted"}`}
                    >
                      {bannerSlide.subtextBn}
                    </span>
                  ) : null}
                  {bannerSlide.ctaLabelBn ? (
                    <span className="mt-3 inline-flex h-10 w-fit items-center rounded-full bg-primary px-4 text-sm font-bold text-white shadow-md">
                      {bannerSlide.ctaLabelBn}
                    </span>
                  ) : null}
                </span>
              </Link>
            </section>
          ) : null}

          {/* ---------- Closing grid: the full fetched list ---------- */}
          {products.length > 0 ? (
            <section className="mt-12" aria-label={s.pickedForYou}>
              <RailHeading title={s.pickedForYou} href="/shop" s={s} />
              <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4">
                {products.map((p) => (
                  <ThemedProductCard key={p.id} product={p} />
                ))}
              </div>
              <div className="mt-6 text-center">
                <Link
                  href="/shop"
                  className="inline-flex h-12 items-center rounded-full border border-primary bg-card px-8 text-sm font-bold text-primary shadow-card transition hover:bg-primary hover:text-white"
                >
                  {s.loadMore}
                </Link>
              </div>
            </section>
          ) : null}

          {/* ---------- Testimonials (real approved reviews) ---------- */}
          <ShobjiHomeTestimonials reviews={customerReviews} />

          <div className="mb-10" />
        </div>
      </div>
    </main>
  );
}
