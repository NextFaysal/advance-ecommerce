import { PageHeader } from "@/admin-shell/PageHeader";
import { isWarehouseOpsEnabled } from "@/warehouse/flags";
import { listPickLists, prismaKeyValueStore } from "@/warehouse/pick-lists";
import { getConfirmedQueue } from "@/warehouse/queue";
import { getRequestLocale } from "@/i18n/server";
import { interpolate, pick } from "@/i18n/locale";
import { WarehouseClient } from "./warehouse-client";
import { WAREHOUSE_STRINGS } from "./strings";

// Admin > Warehouse (ADV-21, doc 22) — pick → pack → ship scanning.
// Locked state: while module.warehouse_ops is OFF (the seeded
// default — paid add-on), the page renders the lock panel instead
// of data, matching the APIs' 403 FEATURE_LOCKED. Data: real
// CONFIRMED orders, real Shipment rows, and pick lists persisted as
// a Setting JSON doc (src/warehouse/*). Nothing here moves stock:
// pick-list completion is a staff attestation, pack completion
// writes an order timeline note, and courier handover is recorded
// as a manual note — the page copy says each of these plainly.

export const dynamic = "force-dynamic";

export default async function WarehousePage() {
  const locale = await getRequestLocale();
  const s = pick(locale, WAREHOUSE_STRINGS);
  if (!isWarehouseOpsEnabled()) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>{s.pageTitle}</h1>
        <p role="status">{interpolate(s.lockedText, { flag: "module.warehouse_ops" })}</p>
      </main>
    );
  }

  const store = prismaKeyValueStore();
  const [queue, lists] = await Promise.all([getConfirmedQueue(store), listPickLists(store)]);

  return (
    <div className="space-y-6">
      <PageHeader title={s.pageTitle} subtitle={s.pageDescription} />
      <WarehouseClient initialQueue={queue} initialLists={lists} />
    </div>
  );
}
