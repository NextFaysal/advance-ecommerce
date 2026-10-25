import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { featureFlags } from "@/lib/feature-flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { LabelsPanel } from "./labels-panel";

export const dynamic = "force-dynamic";

// Admin > Products > Barcode Labels — Wave 15-3 (doc 16 §P7).
// Behind module.product_extras (paid add-on, OFF by default). Pick
// variants that HAVE barcodes (the panel says plainly which cannot
// be labelled and why), set copies/config, and print a label sheet —
// barcodes are real CODE128 rendered by JsBarcode, never decorative
// stripes. The print stylesheet isolates the sheet so only labels
// come out of the printer.
export default async function ProductLabelsPage() {
  await ensureDbFeatureFlags();
  const enabled = featureFlags.isFeatureEnabled("module.product_extras");
  return (
    <main>
      <PageHeader
        title="বারকোড লেবেল"
        description="ভ্যারিয়েন্ট বেছে লেবেল ছাপুন (Barcode Labels — module.product_extras)"
        breadcrumb="Admin / Products / Labels"
      />
      {!enabled ? (
        <Card className="p-6">
          <p role="status" className="text-sm leading-relaxed">
            🔒 প্রোডাক্ট এক্সট্রা মডিউল বন্ধ আছে (<code>module.product_extras</code> OFF) — এটি একটি পেইড অ্যাড-অন।
            খুলতে Admin &gt; Settings &gt; Feature Flags থেকে <code>module.product_extras</code> চালু করুন।
            <span className="mt-1 block text-text-subtle">
              (This module is locked — enable the <code>module.product_extras</code> feature flag to unlock it.)
            </span>
          </p>
        </Card>
      ) : (
        <LabelsPanel />
      )}
    </main>
  );
}
