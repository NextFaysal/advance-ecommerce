import type { Metadata } from "next";
import { listActivePublicProducts, listCategories } from "@/catalog/server-read";
import { CountUp } from "@/components/ui/count-up";
import { getActiveHeroSlides } from "@/cms/site-content";
import { marketingMechanicsEnabled } from "@/marketing/docs";
import { getRunningHeroExperiment } from "@/marketing/experiments";
import { listHomepageReviews } from "@/reviews/store";
import { getThemeSlots, AURORA_SLOTS } from "@/themes/slot-registry";
import { resolveStorefrontThemeFromStore } from "@/themes/resolution-server";
import { ThemeBoundary } from "@/themes/theme-boundary";
import type { HomeSectionsProps } from "@/themes/slots";
import { pick } from "@/i18n/locale";
import { getStoreDefaultLocale } from "@/i18n/server";
import { STORE_STRINGS } from "./(store)/store-strings";

// NOTE on route groups: Next.js forbids both app/page.tsx and app/(store)/page.tsx
// (both map to "/"). So the storefront home lives HERE, and only shop/product/search
// live under app/(store)/. This file is the Step 11 home skeleton.
// Data: real catalog DB via src/catalog/server-read (ACTIVE products +
// live categories). An empty DB renders honest empty states — no mock data.
// Design refresh (Direction A — Premium): editorial hero, trust row,
// tinted category tiles, flash-sale + featured rails, inverse "why us"
// band, testimonials, newsletter. Sections with no data hide themselves
// entirely — the homepage never shows a bare empty box.
// Wave 46: statically rendered with ISR (revalidate 60s) — the two
// per-visitor personalisations that forced force-dynamic moved
// client-side: the hero A/B variant (HeroExperiment component +
// /api/v1/public/experiments/hero) and the spin wheel's signed-in
// state (SpinWheelWidget resolves /account/me on mount).
// Wave S3a (doc 25): the section composition itself is now the active
// theme package's HomeSections slot (Aurora's lives in
// src/themes/aurora/home-sections.tsx, moved verbatim from this
// file). This page keeps ALL data fetching and passes the loaded
// objects to the slot unchanged; theme resolution reads only
// store-global catalog data (no request APIs), so the ISR behaviour
// above is unchanged.
export const revalidate = 60;

// Doc 30: metadata + the hero stat labels follow the STORE DEFAULT
// locale. ISR-safe — getStoreDefaultLocale reads only the settings
// store (no cookies/headers), so the static render above is unchanged;
// the per-visitor override applies to client surfaces after mount.
export async function generateMetadata(): Promise<Metadata> {
  const s = pick(await getStoreDefaultLocale(), STORE_STRINGS);
  return {
    title: s.homeMetaTitle,
    description: s.homeMetaDescription,
    openGraph: {
      title: "Advance Ecommerce",
      description: s.homeOgDescription,
      type: "website",
    },
  };
}

export default async function Home() {
  const s = pick(await getStoreDefaultLocale(), STORE_STRINGS);
  const [products, categories, heroSlides, customerReviews] = await Promise.all([
    listActivePublicProducts(8),
    listCategories(),
    // CMS hero campaign slides (Admin → Content). Fail-safe: the
    // store degrades to [] on any DB problem, and [] renders the
    // static hero below — byte-identical to the pre-CMS homepage.
    getActiveHeroSlides(),
    // "Customer words" = REAL approved product reviews (rating >= 4),
    // never written-in quotes. Fail-safe to [] — and [] renders no
    // section at all, exactly like the other data-driven sections.
    listHomepageReviews(6).catch(() => []),
  ]);
  // A/B hero experiment (ADV-18B): the per-visitor resolution now
  // happens client-side (HeroExperiment fetches
  // /api/v1/public/experiments/hero, which runs resolveHeroForVisitor
  // with the same exposure recording) so this page can render
  // statically. Server-side we only compute whether a variant COULD
  // apply: mechanics flag on AND a hero experiment running — the
  // running check needs no visitor id. Fail-safe to false.
  const mechanicsOn = marketingMechanicsEnabled();
  const experimentActive = mechanicsOn
    ? await getRunningHeroExperiment()
        .then((experiment) => experiment !== null)
        .catch(() => false)
    : false;
  // Real catalogue totals for the hero stat row (Design v3) — summed
  // from the same category fetch; the row hides when the store is empty.
  const totalProducts = categories.reduce((sum, c) => sum + c.productCount, 0);

  // Real catalogue stats — animated counters (v3); hidden entirely
  // while the catalogue is empty. Used by both hero variants.
  const heroStats = totalProducts > 0 ? (
    <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4 border-t border-border pt-5">
      <div>
        <dd className="text-2xl font-extrabold tabular-nums text-text-main">
          <CountUp value={totalProducts} />+
        </dd>
        <dt className="mt-0.5 text-xs font-medium text-text-muted">{s.homeStatProducts}</dt>
      </div>
      <div>
        <dd className="text-2xl font-extrabold tabular-nums text-text-main">
          <CountUp value={categories.length} />
        </dd>
        <dt className="mt-0.5 text-xs font-medium text-text-muted">{s.homeStatCategories}</dt>
      </div>
      <div>
        <dd className="text-2xl font-extrabold tabular-nums text-text-main">
          <CountUp value={64} />
        </dd>
        <dt className="mt-0.5 text-xs font-medium text-text-muted">{s.homeStatDistricts}</dt>
      </div>
    </dl>
  ) : null;

  // Theme slot resolution (S3a): the section composition is the
  // active package's HomeSections slot, with Aurora as the registry
  // fallback per slot and as the ThemeBoundary fallback at runtime.
  const { themeView } = await resolveStorefrontThemeFromStore();
  const HomeSections = getThemeSlots(themeView.packageId).HomeSections;
  const AuroraHomeSections = AURORA_SLOTS.HomeSections;
  const sectionsProps: HomeSectionsProps = {
    products,
    categories,
    heroSlides,
    customerReviews,
    mechanicsOn,
    experimentActive,
    heroStats,
  };

  return (
    <ThemeBoundary
      slotName="HomeSections"
      packageId={themeView.packageId}
      fallback={<AuroraHomeSections {...sectionsProps} />}
    >
      <HomeSections {...sectionsProps} />
    </ThemeBoundary>
  );
}
