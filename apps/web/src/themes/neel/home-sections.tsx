/**
 * Neel HomeSections slot — doc 27 T-E.
 *
 * The blue marketplace home composition, built ONLY from the data
 * the home page passes in (HomeSectionsProps — the same fetch
 * every package receives):
 *
 *   hero (carousel + 2×2 promo tiles) → trust strip → CIRCULAR
 *   category row (the signature) → featured rail → per-category
 *   rails (+ a full-width banner when a third CMS slide exists)
 *   → product grid + LOAD MORE → testimonials.
 *
 * The one invisible platform element is VisitorIdBootstrap: it
 * renders nothing and only keeps the marketing-mechanics
 * bootstrap running under this theme, gated by the same flag.
 *
 * Honest-data rules, enforced by construction:
 * - Category rails group the fetched products by their REAL
 *   `categorySlug` (PublicProduct carries it). A rail renders
 *   only for a category that actually has fetched products;
 *   membership is never invented. The page fetches a flat
 *   featured list (8 products), so rails are necessarily thin —
 *   the closing grid always carries the full list + LOAD MORE.
 * - Testimonials are the real approved homepage reviews.
 * - No sales counts, ranks or ratings are fabricated anywhere.
 *
 * Option gating happens in the client islands (hero promo tiles,
 * category circles) — this server composition stays option-free
 * and passes the data through.
 */
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { VisitorIdBootstrap } from "@/marketing/components/VisitorIdBootstrap";
import { ThemedProductCard } from "../themed-product-card";
import type { HomeSectionsProps } from "../slots";
import NeelHomeHero from "./home-hero";
import NeelHomeCategories from "./home-categories";
import NeelHomeTopSelling from "./home-top-selling";
import NeelHomeTestimonials from "./home-testimonials";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { NEEL_STRINGS, type NeelStrings } from "./strings";

/* Our own generic service points (icon + line), drawn from the
   platform's real storefront promises — COD, nationwide delivery,
   easy returns, tracked orders. Copy is ours. */
function trustItems(s: NeelStrings) {
  return [
    { icon: "banknote", title: s.trustCodTitle, text: s.trustCodText },
    { icon: "truck", title: s.trustDeliveryTitle, text: s.trustDeliveryText },
    { icon: "package", title: s.trustTrackingTitle, text: s.trustTrackingText },
    { icon: "rotate-ccw", title: s.trustReturnTitle, text: s.trustReturnText },
  ] as const;
}

/** Rail section heading: title left with a short blue underline,
 *  "সব দেখুন →" right. */
function RailHeading({ title, href, s }: { title: string; href: string; s: NeelStrings }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-xl font-extrabold text-text-main sm:text-2xl">{title}</h2>
        <span aria-hidden="true" className="mt-1.5 block h-[3px] w-10 rounded-full bg-primary" />
      </div>
      <Link href={href} className="shrink-0 text-sm font-bold text-primary hover:underline">
        {s.viewAllLink}
      </Link>
    </div>
  );
}

export default async function NeelHomeSections({
  products,
  categories,
  heroSlides,
  customerReviews,
  mechanicsOn,
  heroStats,
}: HomeSectionsProps) {
  const locale = await getRequestLocale();
  const s = pick(locale, NEEL_STRINGS);
  const TRUST_ITEMS = trustItems(s);
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

  // Full-width banner slot: a third CMS slide, when the merchant
  // has one, sits between the rails and the closing grid.
  const bannerSlide = heroSlides.length >= 3 ? heroSlides[2]! : null;

  return (
    <main className="mx-auto min-w-0 max-w-[1440px] px-4 sm:px-6">
      {/* Invisible mechanics bootstrap (renders nothing) — parity
          with the other packages' mount, same flag gate. */}
      {mechanicsOn ? <VisitorIdBootstrap /> : null}

      {/* ---------- Hero: carousel + 2×2 promo tiles ---------- */}
      <NeelHomeHero slides={heroSlides} categories={categories} />
      {heroStats ? <div className="mt-4">{heroStats}</div> : null}

      {/* ---------- Trust strip (our own generic service points) ---------- */}
      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={s.benefitsAria}>
        {TRUST_ITEMS.map((item) => (
          <div
            key={item.title}
            className="flex items-center gap-3 rounded-lg border border-border bg-card p-3.5 shadow-card"
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

      {/* ---------- Circular category row (signature) ---------- */}
      <NeelHomeCategories categories={categories} />

      {/* ---------- Featured rail (the store's featured list) ---------- */}
      <NeelHomeTopSelling products={products} />

      {/* ---------- Category rails (real membership only) ---------- */}
      {rails.map(({ category, items }) => (
        <section key={category.slug} className="mt-12" aria-label={category.name[locale] || category.name.bn}>
          <RailHeading s={s} title={category.name[locale] || category.name.bn} href={`/shop?category=${category.slug}`} />
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
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
                <span className="mt-3 inline-flex h-10 w-fit items-center rounded-md bg-primary px-4 text-sm font-bold text-white shadow-md">
                  {bannerSlide.ctaLabelBn}
                </span>
              ) : null}
            </span>
          </Link>
        </section>
      ) : null}

      {/* ---------- Product grid + LOAD MORE ---------- */}
      {products.length > 0 ? (
        <section className="mt-12" aria-label={s.pickedForYou}>
          <RailHeading title={s.pickedForYou} href="/shop" s={s} />
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {products.map((p) => (
              <ThemedProductCard key={p.id} product={p} />
            ))}
          </div>
          <div className="mt-6 text-center">
            <Link
              href="/shop"
              className="inline-flex h-12 items-center rounded-md border border-primary bg-card px-8 text-sm font-bold text-primary shadow-card transition hover:bg-primary hover:text-white"
            >
              {s.loadMore}
            </Link>
          </div>
        </section>
      ) : null}

      {/* ---------- Testimonials (real approved reviews) ---------- */}
      <NeelHomeTestimonials reviews={customerReviews} />

      <div className="mb-10" />
    </main>
  );
}
