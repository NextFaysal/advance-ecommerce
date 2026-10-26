import { isWarehouseOpsEnabled } from "@/warehouse/flags";
import { listPickLists, prismaKeyValueStore } from "@/warehouse/pick-lists";
import { getConfirmedQueue } from "@/warehouse/queue";
import { WarehouseHome } from "./warehouse-home";

// Warehouse scanner PWA home (wave 58). The layout performs the
// cookie-presence gate; this page mirrors the admin warehouse page
// (app/admin/warehouse/page.tsx) exactly: same flag gate, same
// server-side initial fetch, and the SAME WarehouseClient component
// underneath — pick → pack (scan-to-tick) → ship scan with zero
// reimplemented logic. While module.warehouse_ops is OFF (the seeded
// default — paid add-on) it renders the same lock panel as the admin
// page, matching the APIs' 403 FEATURE_LOCKED.
export const dynamic = "force-dynamic";

export default async function WarehousePwaPage() {
  if (!isWarehouseOpsEnabled()) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>ওয়্যারহাউস</h1>
        <p role="status">
          🔒 This module is locked for this install. Warehouse ops is a paid add-on —
          enable <code>module.warehouse_ops</code> in Admin &gt; Settings &gt; Feature Flags to unlock it.
        </p>
      </main>
    );
  }

  const store = prismaKeyValueStore();
  const [queue, lists] = await Promise.all([getConfirmedQueue(store), listPickLists(store)]);

  return <WarehouseHome initialQueue={queue} initialLists={lists} />;
}
