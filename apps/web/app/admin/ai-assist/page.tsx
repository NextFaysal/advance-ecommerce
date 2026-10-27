import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { listActiveProducts } from "@/catalog/server-read";
import { maxVariantPricePoisha, minVariantPricePoisha, type Product } from "@/catalog/types";
import { AI_FEATURE_FLAG } from "@/ai/types";
import { demoAiAssistFlags, isAiAssistEnabled } from "./demo-flag";
import { AiAssistTools, type SampleProductOption } from "./tools";
import { getRequestLocale } from "@/i18n/server";
import { pick, type Locale } from "@/i18n/locale";
import { AI_ASSIST_STRINGS } from "./strings";

// Admin > AI Assist — Agent 45, UI over Agent 15's src/ai services.
// Locked state: while module.ai_assist is OFF (seeded default — paid
// add-on), the page renders the lock panel, matching the AI API routes'
// fail-closed requireFeature() check and the fraud / automation / POS
// page pattern. The flag read here goes through ./demo-flag.ts, which
// delegates to the ONE unified demo flag store in
// src/lib/feature-flags.ts (defaults OFF) until a DB-backed flag reader
// is wired — the same store the feature-flags API toggles.
//
// HONESTY: there is NO real AI model behind this page. The tools call
// the template/keyword fallbacks in src/ai directly (client-side, no
// network), and every output is stamped "template-fallback — মানুষের
// রিভিউ লাগবে" from the result's own meta. Sample products come from
// the REAL catalog DB (ACTIVE products via src/catalog/server-read).
// Real wiring: a provider implementing the
// AiProvider seam (src/ai/types.ts) with its key ENCRYPTED in Admin >
// Settings; the API routes /api/v1/admin/ai/* swap the engine and the
// response types do not change.

function attributesOf(product: Product): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const variant of product.variants) {
    for (const [key, value] of Object.entries(variant.attributes)) {
      const list = out[key] ?? [];
      if (!list.includes(value)) list.push(value);
      out[key] = list;
    }
  }
  return out;
}

async function sampleOptions(locale: Locale): Promise<SampleProductOption[]> {
  const s = pick(locale, AI_ASSIST_STRINGS);
  const products = await listActiveProducts(100);
  return products.filter((p) => p.status === "ACTIVE").map((p) => ({
    id: p.id,
    label: `${p.title.bn} (${p.title.en})${s.sampleSuffix}`,
    input: {
      product: {
        title: p.title,
        categoryName: p.categoryName,
        brandName: p.brandName,
        tags: p.tags,
        ratingAverage: p.ratingAverage,
        reviewCount: p.reviewCount,
        attributes: attributesOf(p),
        minPricePoisha: minVariantPricePoisha(p),
        maxPricePoisha: maxVariantPricePoisha(p),
      },
    },
  }));
}

export const dynamic = "force-dynamic";

export default async function AdminAiAssistPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, AI_ASSIST_STRINGS);
  await ensureDbFeatureFlags().catch(() => {});
  if (!isAiAssistEnabled(demoAiAssistFlags)) {
    return (
      <main>
        <PageHeader title={s.title} description={s.description} />
        <p role="status">
          {s.lockedText1}
          <code>{AI_FEATURE_FLAG}</code>
          {s.lockedText2}
        </p>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <PageHeader title={s.title} description={s.description} />

      <p role="note" className="rounded-lg border border-border bg-surface-2 p-3 text-sm">
        {s.demoNote1}
        <strong>{s.demoNoteStrong1}</strong>
        {s.demoNote2}
        <code>src/ai</code>
        {s.demoNote3}
        <strong>{s.demoNoteStrong2}</strong>
        {s.demoNote4}
      </p>

      <AiAssistTools samples={await sampleOptions(locale)} />

      <Card className="p-4">
        <h3 className="text-base font-semibold">{s.providerTitle}</h3>
        <p className="mt-1 text-sm leading-relaxed text-text-muted">
          {s.providerText1}
          <code>AiProvider</code>
          {s.providerText2}
          <code>src/ai/types.ts</code>
          {s.providerText3}
          <strong>{s.providerStrong}</strong>
          {s.providerText4}
          <code>/api/v1/admin/ai/*</code>
          {s.providerText5}
          <code>provider</code>
          {s.providerText6}
        </p>
        <p className="mt-3 text-sm">
          <Link href="/admin/settings/integrations" className="font-medium text-brand-700 underline">
            {s.providerLink}
          </Link>
        </p>
      </Card>
    </main>
  );
}
