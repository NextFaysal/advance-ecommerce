import { PageHeader } from "@/components/ui/page-header";
import { demoAdvancedOrderStore } from "@/advanced-orders";
import { AdvancedOrdersClient } from "./advanced-orders-client";
import { SAMPLE_EXTRA_PREORDERS } from "./sample-data";
import { demoAdvancedOrdersFlag, isAdvancedOrdersEnabled } from "./flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";

// Admin > Advanced Orders — Agent 43, UI over Agent 16's Step 48 (A9)
// pure functions in src/advanced-orders (split allocation, partial
// payment/refund, exchange, merge validation, pre-orders).
// TEMPORARY DEMO: all panels run those real functions over SAMPLE data in
// client page state — nothing is submitted or persisted, and the page says
// so. The pre-order list merges the shared in-memory demo store's row
// (demoAdvancedOrderStore) with page-local SAMPLE rows. Real wiring: the
// same operations exist behind /api/v1/admin/advanced-orders with
// Prisma-backed stores once Prisma generate succeeds.
// Flag gating (Agent 46; unified by Agent 60): `module.advanced_orders`
// was added to the seed FEATURE_FLAGS on 2026-10-24 (after Agent 43) and
// the nav item now carries it with a `locked-add-on` badge, so this page
// renders the established lock panel while the flag is OFF — the same
// pattern as automation / fraud / riders / b2b. The gate reads ./flags.ts,
// which delegates to the ONE unified demo flag store in
// src/lib/feature-flags.ts (defaults OFF) — the stand-in for the DB flag
// reader until Prisma wiring lands, and the same store the feature-flags
// API toggles.

export default async function AdvancedOrdersPage() {
  await ensureDbFeatureFlags().catch(() => {});
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
          (ডেমো নোট: এই পেজটি এখন একটি page-local ডেমো ফ্ল্যাগ দিয়ে গেট করা — {demoAdvancedOrdersFlag.note})
        </p>
      </main>
    );
  }

  const preOrders = [...demoAdvancedOrderStore.listPreOrders(), ...SAMPLE_EXTRA_PREORDERS];
  return (
    <div>
      <PageHeader
        title="অ্যাডভান্সড অর্ডার"
        description="স্প্লিট শিপমেন্ট, আংশিক পেমেন্ট/ডেলিভারি, এক্সচেঞ্জ, অর্ডার মার্জ ও প্রি-অর্ডার — সব হিসাব src/advanced-orders এর আসল ফাংশন দিয়ে।"
        breadcrumb="অ্যাডমিন / বিক্রয় / অ্যাডভান্সড অর্ডার"
      />
      <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>TEMPORARY DEMO:</strong> এই পেজের সব অর্ডার, গুদাম স্টক ও প্রি-অর্ডার SAMPLE ডেটা।
        প্যানেলগুলো আসল লজিক চালালেও ফলাফল শুধু এই পেজের state-এ থাকে — কোনো অর্ডার, পেমেন্ট বা
        স্টক সত্যিকারে বদলায় না, কিছুই সার্ভারে পাঠানো বা সংরক্ষণ করা হয় না।
      </div>
      <AdvancedOrdersClient initialPreOrders={preOrders} />
    </div>
  );
}
