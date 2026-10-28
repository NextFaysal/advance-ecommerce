import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { funnelStore } from "@/funnels/store";
import { funnelStepMetadata, renderFunnelStepPage } from "@/funnels/step-page";

// Public funnel entry — doc 34 §3.7 (wave L7).
// /f/<slug> renders the funnel's first step (the entry landing
// step). Only PUBLISHED funnels route: unknown slug OR draft /
// archived funnel both return notFound() identically (no draft
// existence leaks), and the step's page itself passes the
// published-only gate inside the shared step renderer.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const funnel = await funnelStore.getPublishedBySlug(params.slug);
  if (!funnel || funnel.steps.length === 0) return { title: "পেজ পাওয়া যায়নি" };
  return funnelStepMetadata(funnel, funnel.steps[0]);
}

export default async function FunnelEntryPage({ params }: { params: { slug: string } }) {
  const funnel = await funnelStore.getPublishedBySlug(params.slug);
  if (!funnel || funnel.steps.length === 0) notFound();
  return renderFunnelStepPage(funnel, funnel.steps[0]);
}
