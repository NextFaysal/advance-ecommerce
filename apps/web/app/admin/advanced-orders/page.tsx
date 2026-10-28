import { PageHeader } from "@/admin-shell/PageHeader";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { ADMIN_STRINGS } from "@/admin/strings";
import { ADVANCED_ORDERS_STRINGS } from "./strings";
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
  const locale = await getRequestLocale();
  const t = pick(locale, ADVANCED_ORDERS_STRINGS);
  const common = pick(locale, ADMIN_STRINGS);
  const breadcrumbs = t.breadcrumb.split(" / ").map((label) => ({ label }));
  await ensureDbFeatureFlags();
  if (!isAdvancedOrdersEnabled()) {
    return (
      <main className="space-y-6">
        <PageHeader
          title={t.title}
          subtitle={t.lockedDesc}
          breadcrumbs={breadcrumbs}
          breadcrumbLabel={common.breadcrumb}
        />
        <p role="status">
          {t.lockedPrefix} <code>{demoAdvancedOrdersFlag.key}</code> {t.lockedSuffix}
          ({pick(locale, demoAdvancedOrdersFlag.note)})
        </p>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.title}
        subtitle={t.desc}
        breadcrumbs={breadcrumbs}
        breadcrumbLabel={common.breadcrumb}
      />
      <AdvancedOrdersClient />
    </div>
  );
}
