import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listActivePublicProducts } from "@/catalog/server-read";
import { landingStore } from "@/landing/store";
import { buildLandingViewModel } from "@/landing/render";
import { LandingView } from "@/landing/components/LandingView";

// Public campaign landing page — Agent 53.
// Only PUBLISHED pages render: unknown slug OR draft/archived slug both
// go through getPublishedBySlug, so both return notFound() identically
// (no draft existence leaks). Both the landing page and its products
// resolve against the REAL database (Prisma): landing pages from the
// LandingPage table, products ACTIVE via src/catalog/server-read — an
// offer whose product is not ACTIVE renders as an unresolved offer,
// never a mock product. Ordering reuses the existing guest-cart add
// helper via AddToCartButton inside LandingView (add -> /cart ->
// checkout).
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const page = await landingStore.getPublishedBySlug(params.slug);
  if (!page) return { title: "পেজ পাওয়া যায়নি" };
  return { title: page.titleBn, description: page.titleEn };
}

export default async function LandingPublicPage({ params }: { params: { slug: string } }) {
  const page = await landingStore.getPublishedBySlug(params.slug);
  if (!page) notFound();
  // Cost-free public shape even here (defense in depth): the view model
  // only ever carries ResolvedOffer fields, but the catalog input is
  // public too, so nothing cost-bearing exists on this page at all.
  const products = await listActivePublicProducts(100);
  const view = buildLandingViewModel(page, products);
  return (
    <main className="min-w-0 pb-10">
      <LandingView view={view} />
      <p className="mt-4 text-center text-xs text-text-muted">ক্যাটালগ ও ল্যান্ডিং পেজ — দুটোই আসল ডাটাবেস থেকে।</p>
    </main>
  );
}
