import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { landingStore } from "@/landing/store";
import { buildLandingViewModel } from "@/landing/render";
import { resolveLandingExtras } from "@/landing/resolve-extras";
import { landingCatalogQueriesPublic, referencedProductIds } from "@/landing/catalog";
import { LandingView } from "@/landing/components/LandingView";
import { getRequestLocale } from "@/i18n/server";

// Public campaign landing page — Agent 53.
// Only PUBLISHED pages render: unknown slug OR draft/archived slug both
// go through getPublishedBySlug, so both return notFound() identically
// (no draft existence leaks). Both the landing page and its products
// resolve against the REAL database (Prisma): landing pages from the
// LandingPage table, products via LandingCatalogQueries (doc 34 §3.4)
// — referenced products resolve BY ID from the live catalog (ACTIVE +
// publishAt gate), so a page referencing any product renders it,
// whatever the catalog size; an offer whose product is not visible
// renders as an unresolved offer, never a mock product. Ordering
// reuses the existing guest-cart add helper via AddToCartButton
// inside LandingView (add -> /cart -> checkout), and the page renders
// in the visitor's locale (doc 30 via doc 34 L1).
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const page = await landingStore.getPublishedBySlug(params.slug);
  if (!page) return { title: "পেজ পাওয়া যায়নি" };
  // Envelope v2 SEO (doc 34 §3.1, surfaced by L6): when the owner has
  // saved an seo block, meta title/description are picked in the
  // VISITOR's locale (doc 30), each field falling back to its other
  // locale and then to the page titles. When no seo block exists
  // (every v1 page), the fallback is EXACTLY the historical behaviour
  // — title = titleBn, description = titleEn — so nothing already
  // indexed changes until an owner opts in.
  if (!page.seo) return { title: page.titleBn, description: page.titleEn };
  const locale = await getRequestLocale();
  const seo = page.seo;
  const pickField = (bn: string, en: string): string =>
    (locale === "en" ? en.trim() || bn.trim() : bn.trim() || en.trim());
  const title = pickField(seo.metaTitleBn, seo.metaTitleEn) || (locale === "en" ? page.titleEn : page.titleBn);
  const description = pickField(seo.metaDescriptionBn, seo.metaDescriptionEn);
  const ogImageUrl = seo.ogImageUrl?.trim() ? seo.ogImageUrl : null;
  return {
    title,
    ...(description ? { description } : {}),
    openGraph: {
      title,
      ...(description ? { description } : {}),
      type: "website",
      ...(ogImageUrl ? { images: [{ url: ogImageUrl }] } : {}),
    },
    ...(ogImageUrl
      ? {
          twitter: {
            card: "summary_large_image" as const,
            title,
            ...(description ? { description } : {}),
            images: [ogImageUrl],
          },
        }
      : {}),
  };
}

export default async function LandingPublicPage({ params }: { params: { slug: string } }) {
  const page = await landingStore.getPublishedBySlug(params.slug);
  if (!page) notFound();
  const locale = await getRequestLocale();
  // Cost-free by construction: the view model only ever carries
  // ResolvedOffer fields, and the catalog input is the landing
  // layer's allowlist shape (LandingCatalogProduct — no cost fields
  // exist in it), so nothing cost-bearing exists on this page at all.
  const products = await landingCatalogQueriesPublic.byIds(referencedProductIds(page));
  // L3 blocks (reviews, bundle contents) resolve from their own
  // tables through the extras pass — approved-only / real-bundle
  // honesty is enforced inside resolveLandingExtras. The L2
  // collections + flash-sale end ride the same pass, resolved with
  // the PUBLIC query instance so the live (visibility) gate applies.
  const extras = await resolveLandingExtras(page, landingCatalogQueriesPublic);
  const view = buildLandingViewModel(page, products, extras);
  return (
    <main className="min-w-0 pb-10">
      <LandingView view={view} locale={locale} />
    </main>
  );
}
