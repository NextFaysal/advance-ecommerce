// Seasonal campaign landing (ADV-17 remainder) — /campaign/<slug>
// for the code-defined presets (eid, boishakh, puja, 1111). A slug
// renders only when the preset exists AND the admin has configured
// AND enabled it in Admin → Marketing Mechanics; otherwise 404.
// Products are resolved live from the configured source (category /
// tag / live flash sale) — never fabricated. The coupon block shows
// only while the named Coupon row genuinely validates right now,
// and the countdown only against a real configured/live end date.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductCard } from "@/catalog/ProductCard";
import { CampaignCountdown } from "@/marketing/components/CampaignCountdown";
import {
  getCampaignPreset,
  loadCampaignsDoc,
  resolveCampaignProducts,
  couponState,
  marketingMechanicsEnabled,
  type CampaignsDoc,
} from "@/marketing/campaign-templates";

export const revalidate = 300;

async function loadEnabled(slug: string) {
  const preset = getCampaignPreset(slug);
  if (preset === null || !marketingMechanicsEnabled()) return null;
  const doc: CampaignsDoc = await loadCampaignsDoc().catch(() => ({}) as CampaignsDoc);
  const config = doc[slug];
  if (!config || !config.enabled) return null;
  return { preset, config };
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const loaded = await loadEnabled(params.slug);
  if (loaded === null) return { title: "ক্যাম্পেইন" };
  const { preset, config } = loaded;
  return {
    title: config.headlineBn ?? preset.headlineBn,
    description: config.subBn ?? preset.subBn,
  };
}

export default async function CampaignPage({ params }: { params: { slug: string } }) {
  const loaded = await loadEnabled(params.slug);
  if (loaded === null) notFound();
  const { preset, config } = loaded;

  const resolved = await resolveCampaignProducts(config).catch(() => ({
    products: [],
    sourceNote: "error",
    effectiveEndsAt: config.endsAt,
  }));

  const headlineBn = config.headlineBn ?? preset.headlineBn;
  const headlineEn = config.headlineEn ?? preset.headlineEn;
  const subBn = config.subBn ?? preset.subBn;

  // Coupon block: only while the code genuinely validates NOW.
  let couponCode: string | null = null;
  if (config.couponCode) {
    const state = await couponState(config.couponCode).catch(() => ({ ok: false as const, reason: "not_found" as const }));
    if (state.ok) couponCode = config.couponCode;
  }

  const endsAt = resolved.effectiveEndsAt;
  const showCountdown = endsAt !== null && new Date(endsAt).getTime() > Date.now();

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
      <section
        className="mt-6 rounded-3xl px-6 py-10 text-white shadow-md sm:px-10"
        style={{ backgroundColor: `rgb(${preset.accentRgb})` }}
      >
        <p className="text-xs font-bold uppercase tracking-widest text-white/75">
          {preset.nameBn} · {preset.nameEn}
        </p>
        <h1 className="mt-2 text-3xl font-extrabold leading-tight sm:text-4xl">{headlineBn}</h1>
        {headlineEn !== headlineBn ? (
          <p className="mt-1 text-sm font-medium text-white/80">{headlineEn}</p>
        ) : null}
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/90 sm:text-base">{subBn}</p>
        {showCountdown && endsAt ? <CampaignCountdown endsAtIso={endsAt} /> : null}
        {couponCode ? (
          <div className="mt-6 inline-flex flex-wrap items-center gap-3 rounded-2xl bg-white/15 px-4 py-3 backdrop-blur">
            <span className="text-sm text-white/85">চেকআউটে এই কোডটি ব্যবহার করুন:</span>
            <code className="rounded-lg bg-white px-3 py-1 font-mono text-base font-bold tracking-wider text-slate-900">
              {couponCode}
            </code>
          </div>
        ) : null}
      </section>

      {resolved.products.length > 0 ? (
        <section className="mt-10">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {resolved.products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      ) : (
        <section className="mt-10 rounded-3xl border border-dashed border-border bg-card p-8 text-center shadow-card">
          <h2 className="font-display text-lg font-bold text-text-main">এই কালেকশনে এখনো কোনো পণ্য যোগ হয়নি</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-text-muted">
            কালেকশনের পণ্যগুলো শীঘ্রই আসছে। ততক্ষণে{" "}
            <a href="/shop" className="font-semibold text-brand-700 underline">
              সব পণ্য দেখুন
            </a>
            ।
          </p>
        </section>
      )}
    </main>
  );
}
