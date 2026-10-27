/**
 * Circuit HomeSections slot — doc 27 T-D.
 *
 * The tech-store home composition, built ONLY from the data the
 * home page passes in (HomeSectionsProps — the same fetch every
 * package receives):
 *
 *   hero (big banner + 2 stacked tiles) → notice strip + utility
 *   cards → categories row → featured rail → per-category rails
 *   (+ a full-width banner when a fourth CMS slide exists) →
 *   "আপনার জন্য বাছাই" grid + view-all → testimonials.
 *
 * Section headings are CENTRED in this package (title + a short
 * orange underline beneath it), unlike the left-aligned rail
 * headings of the grocery package.
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
 *   always carries the full list.
 * - Testimonials are the real approved homepage reviews.
 * - No sales counts, ranks or ratings are fabricated anywhere.
 *
 * Option gating (showUtilityCards) happens in the client island —
 * this server composition stays option-free and passes the data
 * through, exactly like the other packages.
 */
import Link from "next/link";
import { VisitorIdBootstrap } from "@/marketing/components/VisitorIdBootstrap";
import { ThemedProductCard } from "../themed-product-card";
import type { HomeSectionsProps } from "../slots";
import CircuitHomeHero from "./home-hero";
import CircuitHomeUtility from "./home-utility";
import CircuitHomeCategories from "./home-categories";
import CircuitHomeFeatured from "./home-featured";
import CircuitHomeTestimonials from "./home-testimonials";

/** Centred section heading — this package's heading anatomy:
 *  title centred with a short orange underline, and an optional
 *  "সব দেখুন →" link pinned to the right on wider screens. */
function CenterHeading({ title, href }: { title: string; href?: string }) {
  return (
    <div className="relative flex items-center justify-center">
      <div className="text-center">
        <h2 className="font-display text-xl font-extrabold text-text-main sm:text-2xl">{title}</h2>
        <span aria-hidden="true" className="mx-auto mt-1.5 block h-[3px] w-10 rounded-full bg-primary" />
      </div>
      {href ? (
        <Link
          href={href}
          className="absolute right-0 hidden shrink-0 text-sm font-bold text-primary hover:underline sm:block"
        >
          সব দেখুন →
        </Link>
      ) : null}
    </div>
  );
}

export default function CircuitHomeSections({
  products,
  categories,
  heroSlides,
  customerReviews,
  mechanicsOn,
  heroStats,
}: HomeSectionsProps) {
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

  // Full-width banner slot: the hero's stacked tiles consume
  // slides 2–3, so a FOURTH CMS slide, when the merchant has one,
  // sits between the rails and the closing grid.
  const bannerSlide = heroSlides.length >= 4 ? heroSlides[3]! : null;

  return (
    <main className="mx-auto min-w-0 max-w-[1440px] px-4 sm:px-6">
      {/* Invisible mechanics bootstrap (renders nothing) — parity
          with Aurora's mount, same flag gate. */}
      {mechanicsOn ? <VisitorIdBootstrap /> : null}

      {/* ---------- Hero: big banner + 2 stacked tiles ---------- */}
      <CircuitHomeHero slides={heroSlides} categories={categories} />
      {heroStats ? <div className="mt-4">{heroStats}</div> : null}

      {/* ---------- Notice strip + utility cards ---------- */}
      <CircuitHomeUtility />

      {/* ---------- Categories ---------- */}
      <CircuitHomeCategories categories={categories} />

      {/* ---------- Featured rail (the store's featured list) ---------- */}
      <CircuitHomeFeatured products={products} />

      {/* ---------- Category rails (real membership only) ---------- */}
      {rails.map(({ category, items }) => (
        <section key={category.slug} className="mt-12" aria-label={category.name.bn}>
          <CenterHeading title={category.name.bn} href={`/shop?category=${category.slug}`} />
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {items.map((p) => (
              <ThemedProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      ))}

      {/* ---------- Full-width banner (fourth CMS slide, if any) ---------- */}
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
                <span className="mt-3 inline-flex h-10 w-fit items-center rounded-lg bg-primary px-4 text-sm font-bold text-white shadow-md">
                  {bannerSlide.ctaLabelBn}
                </span>
              ) : null}
            </span>
          </Link>
        </section>
      ) : null}

      {/* ---------- Closing grid: the full fetched list ---------- */}
      {products.length > 0 ? (
        <section className="mt-12" aria-label="আপনার জন্য বাছাই">
          <CenterHeading title="আপনার জন্য বাছাই" href="/shop" />
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {products.map((p) => (
              <ThemedProductCard key={p.id} product={p} />
            ))}
          </div>
          <div className="mt-6 text-center">
            <Link
              href="/shop"
              className="inline-flex h-12 items-center rounded-lg bg-primary px-8 text-sm font-bold text-white shadow-card transition hover:opacity-90"
            >
              সব পণ্য দেখুন
            </Link>
          </div>
        </section>
      ) : null}

      {/* ---------- Testimonials (real approved reviews) ---------- */}
      <CircuitHomeTestimonials reviews={customerReviews} />

      <div className="mb-10" />
    </main>
  );
}
