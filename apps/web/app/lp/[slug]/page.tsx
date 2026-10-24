import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MOCK_PRODUCTS } from "@/catalog/mock";
import { landingStore } from "@/landing/store";
import { buildLandingViewModel } from "@/landing/render";
import { LandingView } from "@/landing/components/LandingView";

// Public campaign landing page — Agent 53.
// Only PUBLISHED pages render: unknown slug OR draft/archived slug both
// go through getPublishedBySlug, so both return notFound() identically
// (no draft existence leaks). Products resolve against the TEMPORARY
// MOCK catalog until the Prisma catalog service lands — the landing
// contracts (validate/render) take any catalog list, so the swap is
// only this import. Ordering reuses the existing guest-cart add helper
// via AddToCartButton inside LandingView (add -> /cart -> checkout).

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const page = landingStore.getPublishedBySlug(params.slug);
  if (!page) return { title: "পেজ পাওয়া যায়নি" };
  return { title: page.titleBn, description: page.titleEn };
}

export default function LandingPublicPage({ params }: { params: { slug: string } }) {
  const page = landingStore.getPublishedBySlug(params.slug);
  if (!page) notFound();
  const view = buildLandingViewModel(page, MOCK_PRODUCTS);
  return (
    <main className="min-w-0 pb-10">
      <LandingView view={view} />
      <p className="mt-4 text-center text-xs text-text-muted">TEMPORARY DEMO — ক্যাটালগ TEMPORARY MOCK, ল্যান্ডিং স্টোর ইন-মেমরি ডেমো।</p>
    </main>
  );
}
