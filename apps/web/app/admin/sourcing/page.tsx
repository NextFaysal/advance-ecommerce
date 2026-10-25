import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Tabs } from "@/components/ui/tabs";
import { featureFlags } from "@/lib/feature-flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { SourcingPanel } from "./sourcing-panel";
import { LandedCostPanel } from "./landed-cost-panel";

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
  await ensureDbFeatureFlags();
  const enabled = featureFlags.isFeatureEnabled("module.sourcing");
  return (
    <main>
      <PageHeader
        title="সোর্সিং"
        description="বিদেশি শপের লিংক থেকে পণ্য আনা ও ল্যান্ডেড খরচ হিসাব (Sourcing — module.sourcing)"
        breadcrumb="Admin / Sourcing"
      />
      {!enabled ? (
        <Card className="overflow-hidden">
          <div className="brand-gradient -mx-5 -mt-5 mb-5 h-1.5" aria-hidden="true" />
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <span aria-hidden="true" className="brand-gradient flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-md">
              <Icon name="shield" size={26} />
            </span>
            <p role="status" className="text-sm leading-relaxed">
              সোর্সিং মডিউল বন্ধ আছে (<code>module.sourcing</code> OFF) — এটি একটি পেইড অ্যাড-অন।
              খুলতে Admin &gt; Settings &gt; Feature Flags থেকে <code>module.sourcing</code> চালু করুন।
              <span className="mt-1 block text-text-subtle">
                (This module is locked — enable the <code>module.sourcing</code> feature flag to unlock it.)
              </span>
            </p>
          </div>
        </Card>
      ) : (
        <Tabs
          defaultId="import"
          tabs={[
            { id: "import", label: "পণ্য ইমপোর্ট (লিংক থেকে)", content: <SourcingPanel /> },
            { id: "landed", label: "ল্যান্ডেড কস্ট ক্যালকুলেটর", content: <LandedCostPanel /> },
          ]}
        />
      )}
    </main>
  );
}
