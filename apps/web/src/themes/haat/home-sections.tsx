/**
 * Haat HomeSections slot — doc 27 theme T-A.
 *
 * The marketplace home composition, built ONLY from the data
 * the home page passes in (HomeSectionsProps — the same fetch
 * every package receives):
 *
 *   hero (carousel + narrow side panel) → hero stats → flash
 *   rail ("আজকের অফার", option-gated island) → category tiles →
 *   per-category product rails → closing product grid +
 *   load-more link.
 *
 * Aurora-only mechanics (countdown flash, spin wheel,
 * social-proof ticker, why-us band, newsletter) do NOT render
 * here, and neither do Bazaar's brands/testimonials rows — this
 * package's home is deliberately denser and more catalogue-like.
 * The one invisible exception is VisitorIdBootstrap: it renders
 * nothing and only keeps the platform's marketing-mechanics
 * bootstrap running under this theme, gated by the same flag.
 *
 * Honest-data rules, enforced by construction:
 * - Category rails group the fetched products by their REAL
 *   `categorySlug` (PublicProduct carries it). A rail renders
 *   only for a category that actually has fetched products;
 *   membership is never invented. The page fetches a flat
 *   featured list (8 products), so rails are necessarily thin —
 *   the closing grid always carries the full list + the
 *   load-more link to /shop.
 * - The flash rail is the same featured list under our own
 *   label — no countdown, no sold counts (see home-flash-rail).
 * - No sales counts, ranks or ratings are fabricated anywhere.
 *
 * Option gating (showFlashRail / heroSidePanel) happens in the
 * client islands — this server composition stays option-free
 * and passes the data through, exactly like the other packages.
 */
import Link from "next/link";
import { VisitorIdBootstrap } from "@/marketing/components/VisitorIdBootstrap";
import { ThemedProductCard } from "../themed-product-card";
import type { HomeSectionsProps } from "../slots";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { HAAT_STRINGS, type HaatStrings } from "./strings";
import HaatHomeHero from "./home-hero";
import HaatHomeFlashRail from "./home-flash-rail";
import HaatHomeCategories from "./home-categories";

/** Rail section heading: title with an orange left bar, an
 *  "all items" link right — this package's rail anatomy. */
function RailHeading({ title, href, s }: { title: string; href: string; s: HaatStrings }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <h2 className="border-l-4 border-primary pl-3 font-display text-xl font-extrabold text-text-main sm:text-2xl">
        {title}
      </h2>
      <Link href={href} className="shrink-0 text-sm font-bold text-primary hover:underline">
        {s.viewAllLink}
      </Link>
    </div>
  );
}

export default async function HaatHomeSections({
  products,
  categories,
  heroSlides,
  mechanicsOn,
  heroStats,
}: HomeSectionsProps) {
  const s = pick(await getRequestLocale(), HAAT_STRINGS);
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

  return (
    <main className="mx-auto min-w-0 max-w-[1440px] px-4 sm:px-6">
      {/* Invisible mechanics bootstrap (renders nothing) — parity
          with the other packages' mount, same flag gate. */}
      {mechanicsOn ? <VisitorIdBootstrap /> : null}

      {/* ---------- Hero: carousel + narrow side panel ---------- */}
      <HaatHomeHero slides={heroSlides} firstCategory={categories[0] ?? null} />
      {heroStats ? <div className="mt-4">{heroStats}</div> : null}

      {/* ---------- Flash rail: আজকের অফার (option-gated) ---------- */}
      <HaatHomeFlashRail products={products} />

      {/* ---------- Category tiles ---------- */}
      <HaatHomeCategories categories={categories} />

      {/* ---------- Category rails (real membership only) ---------- */}
      {rails.map(({ category, items }) => (
        <section key={category.slug} className="mt-12" aria-label={category.name.bn}>
          <RailHeading title={category.name.bn} href={`/shop?category=${category.slug}`} s={s} />
          <div className="mt-5 grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-6">
            {items.map((p) => (
              <ThemedProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      ))}

      {/* ---------- Closing grid: the full fetched list ---------- */}
      {products.length > 0 ? (
        <section className="mt-12" aria-label={s.pickedForYou}>
          <RailHeading title={s.pickedForYou} href="/shop" s={s} />
          <div className="mt-5 grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-6">
            {products.map((p) => (
              <ThemedProductCard key={p.id} product={p} />
            ))}
          </div>
          <div className="mt-6 text-center">
            <Link
              href="/shop"
              className="inline-flex h-12 items-center rounded bg-primary px-8 text-sm font-bold text-white shadow-card transition hover:opacity-90"
            >
              {s.moreProducts}
            </Link>
          </div>
        </section>
      ) : null}

      <div className="mb-10" />
    </main>
  );
}
