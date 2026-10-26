import { PageHeader } from "@/components/ui/page-header";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { AdvancedOrdersClient } from "./advanced-orders-client";
import { demoAdvancedOrdersFlag, isAdvancedOrdersEnabled } from "./flags";

// Admin > Advanced Orders — Agent 43 UI over Agent 16's Step 48 (A9)
// functions in src/advanced-orders; WIRED to the real API by W0-D
// (doc 21 G3-7). The page used to run every panel over SAMPLE data in
// client state ("TEMPORARY DEMO") even though a DB-backed API existed.
// Now: pre-orders + stock transfers load from
// GET /api/v1/admin/advanced-orders (PrismaAdvancedOrderStore,
// meta.persistence "database"); the split planner POSTs real order
// lines + real per-warehouse inventory to the same route's preview
// endpoint (pure computation — the API itself answers persisted:
// false, and the panel says so); payment figures are the selected
// order's real totals (order detail + refund workbench summary);
// preorder fulfilment posts to /api/v1/admin/preorders/[id]/fulfil,
// which creates the actual order server-side. Order MERGE has no
// backend anywhere in the system — its panel is an honest note, not
// a fake action.
// Flag gating: `module.advanced_orders` (seeded OFF, paid add-on) —
// while OFF this page renders the established lock panel, the same
// pattern as automation / fraud / riders / b2b. The gate reads
// ./flags.ts over the unified flag store, hydrated from the DB by
// ensureDbFeatureFlags() below (wave-28 pattern).

export default async function AdvancedOrdersPage() {
  await ensureDbFeatureFlags();
  if (!isAdvancedOrdersEnabled()) {
    return (
      <main>
        <PageHeader
          title="অ্যাডভান্সড অর্ডার"
          description="স্প্লিট শিপমেন্ট, আংশিক পেমেন্ট/ডেলিভারি, এক্সচেঞ্জ, অর্ডার মার্জ ও প্রি-অর্ডার (ধাপ ৪৮, A9)"
          breadcrumb="অ্যাডমিন / বিক্রয় / অ্যাডভান্সড অর্ডার"
        />
        <p role="status">
          🔒 এই মডিউলটি এই ইনস্টলের জন্য লক করা আছে। অ্যাডভান্সড অর্ডার একটি পেইড অ্যাড-অন —
          আনলক করতে Admin &gt; Settings &gt; Feature Flags-এ <code>{demoAdvancedOrdersFlag.key}</code> চালু করুন।
          ({demoAdvancedOrdersFlag.note})
        </p>
      </main>
    );
  }

  return (
    <div>
      <PageHeader
        title="অ্যাডভান্সড অর্ডার"
        description="স্প্লিট শিপমেন্ট প্ল্যান, পেমেন্ট অবস্থা, এক্সচেঞ্জ হিসাব, স্টক ট্রান্সফার ও প্রি-অর্ডার — সবই আসল API ও ডাটাবেস থেকে।"
        breadcrumb="অ্যাডমিন / বিক্রয় / অ্যাডভান্সড অর্ডার"
      />
      <AdvancedOrdersClient />
    </div>
  );
}
