import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { listActiveProducts } from "@/catalog/server-read";
import { maxVariantPricePoisha, minVariantPricePoisha, type Product } from "@/catalog/types";
import { AI_FEATURE_FLAG } from "@/ai/types";
import { demoAiAssistFlags, isAiAssistEnabled } from "./demo-flag";
import { AiAssistTools, type SampleProductOption } from "./tools";

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

async function sampleOptions(): Promise<SampleProductOption[]> {
  const products = await listActiveProducts(100);
  return products.filter((p) => p.status === "ACTIVE").map((p) => ({
    id: p.id,
    label: `${p.title.bn} (${p.title.en}) — নমুনা পণ্য`,
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
  if (!isAiAssistEnabled(demoAiAssistFlags)) {
    return (
      <main>
        <PageHeader title="AI সহায়ক (AI Assist)" description="পণ্যের বর্ণনা, SEO ও রিভিউ সহায়ক (টেমপ্লেট-ভিত্তিক)" />
        <p role="status">
          🔒 এই মডিউলটি এই ইনস্টলের জন্য লক করা আছে। AI সহায়ক একটি পেইড অ্যাড-অন —
          আনলক করতে Admin &gt; Settings &gt; Feature Flags-এ <code>{AI_FEATURE_FLAG}</code> চালু করুন।
        </p>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <PageHeader title="AI সহায়ক (AI Assist)" description="পণ্যের বর্ণনা, SEO ও রিভিউ সহায়ক (টেমপ্লেট-ভিত্তিক)" />

      <p role="note" className="rounded-lg border border-border bg-surface-2 p-3 text-sm">
        ⚠️ <strong>TEMPORARY DEMO:</strong> এই পেজে কোনো আসল AI মডেল নেই। সব আউটপুট{" "}
        <code>src/ai</code>-এর টেমপ্লেট/কিওয়ার্ড ফলব্যাক থেকে আসে এবং প্রতিটিতেই{" "}
        <strong>template-fallback — মানুষের রিভিউ লাগবে</strong> স্ট্যাম্প থাকে। নমুনা পণ্যগুলো আসল
        ক্যাটালগ ডাটাবেস থেকে নেওয়া।
      </p>

      <AiAssistTools samples={await sampleOptions()} />

      <Card className="p-4">
        <h3 className="text-base font-semibold">আসল AI প্রোভাইডার — পরে যুক্ত হবে</h3>
        <p className="mt-1 text-sm leading-relaxed text-text-muted">
          আসল AI প্রোভাইডার পরে <code>AiProvider</code> seam (<code>src/ai/types.ts</code>) দিয়ে যুক্ত হবে — এর API
          কী থাকবে Admin &gt; Settings-এ <strong>এনক্রিপ্ট করা</strong> অবস্থায়, শুধু সার্ভার সাইডে। তখন API রুটগুলোর
          (<code>/api/v1/admin/ai/*</code>) ইঞ্জিন <code>provider</code> হয়ে যাবে, রেসপন্সের ধরন বদলাবে না; আর এই
          টেমপ্লেট ফলব্যাকটাই অফলাইন মোড হিসেবে থেকে যাবে।
        </p>
        <p className="mt-3 text-sm">
          <Link href="/admin/settings/integrations" className="font-medium text-brand-700 underline">
            Admin &gt; Settings &gt; Integrations-এ যান →
          </Link>
        </p>
      </Card>
    </main>
  );
}
