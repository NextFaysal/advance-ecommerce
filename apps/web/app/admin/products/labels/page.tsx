import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { featureFlags } from "@/lib/feature-flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { LabelsPanel } from "./labels-panel";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { PRODUCTS_STRINGS } from "../strings";

export const dynamic = "force-dynamic";

// Admin > Products > Barcode Labels — Wave 15-3 (doc 16 §P7).
// Behind module.product_extras (paid add-on, OFF by default). Pick
// variants that HAVE barcodes (the panel says plainly which cannot
// be labelled and why), set copies/config, and print a label sheet —
// barcodes are real CODE128 rendered by JsBarcode, never decorative
// stripes. The print stylesheet isolates the sheet so only labels
// come out of the printer.
export default async function ProductLabelsPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, PRODUCTS_STRINGS);
  await ensureDbFeatureFlags();
  const enabled = featureFlags.isFeatureEnabled("module.product_extras");
  return (
    <main>
      <PageHeader
        title={s.labelsTitle}
        description={s.labelsDesc}
        breadcrumb={s.labelsBreadcrumb}
      />
      {!enabled ? (
        <Card className="overflow-hidden">
          <div className="brand-gradient -mx-5 -mt-5 mb-5 h-1.5" aria-hidden="true" />
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <span aria-hidden="true" className="brand-gradient flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-md">
              <Icon name="shield" size={26} />
            </span>
            <p role="status" className="text-sm leading-relaxed">
              {s.labelsLockedPre}<code>module.product_extras</code> OFF{s.labelsLockedMid} <code>module.product_extras</code> {s.labelsLockedPost}
              <span className="mt-1 block text-text-subtle">
                {s.labelsLockedNote}
              </span>
            </p>
          </div>
        </Card>
      ) : (
        <LabelsPanel />
      )}
    </main>
  );
}
