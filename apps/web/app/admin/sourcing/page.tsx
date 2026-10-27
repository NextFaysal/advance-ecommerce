import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Tabs } from "@/components/ui/tabs";
import { featureFlags } from "@/lib/feature-flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { SourcingPanel } from "./sourcing-panel";
import { LandedCostPanel } from "./landed-cost-panel";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { SOURCING_STRINGS } from "./strings";

export const dynamic = "force-dynamic";

// Admin > Sourcing — Wave 15-3 (doc 16 §P7, Part H sourcing suite).
// Two tools behind the module.sourcing flag (paid add-on, OFF by
// default — the locked panel below matches the APIs' 403
// FEATURE_LOCKED):
//  1. পণ্য ইমপোর্ট — paste an AliExpress/1688/Alibaba (or any shop)
//     product URL; the server fetches + extracts a preview
//     (POST /api/v1/admin/sourcing/preview), the merchant edits it,
//     and create lands a DRAFT product through the normal create
//     contract. Currency conversion is NEVER automatic: a foreign
//     price is shown as detected and the merchant types the ৳ price
//     (the calculator tab helps work it out).
//  2. ল্যান্ডেড কস্ট ক্যালকুলেটর — unit price × rate + shipping +
//     duty + local transport = per-unit landed cost in exact poisha,
//     with a margin table and a one-click "set as variant cost"
//     (PATCH through the products API, reason attached).
export default async function AdminSourcingPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, SOURCING_STRINGS);
  await ensureDbFeatureFlags();
  const enabled = featureFlags.isFeatureEnabled("module.sourcing");
  return (
    <main>
      <PageHeader title={s.title} description={s.description} breadcrumb={s.breadcrumb} />
      {!enabled ? (
        <Card className="overflow-hidden">
          <div className="brand-gradient -mx-5 -mt-5 mb-5 h-1.5" aria-hidden="true" />
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <span aria-hidden="true" className="brand-gradient flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-md">
              <Icon name="shield" size={26} />
            </span>
            <p role="status" className="text-sm leading-relaxed">
              {s.locked}
            </p>
          </div>
        </Card>
      ) : (
        <Tabs
          defaultId="import"
          tabs={[
            { id: "import", label: s.tabImport, content: <SourcingPanel /> },
            { id: "landed", label: s.tabLanded, content: <LandedCostPanel /> },
          ]}
        />
      )}
    </main>
  );
}
