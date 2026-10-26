import { PageHeader } from "@/components/ui/page-header";
import { isWarehouseOpsEnabled } from "@/warehouse/flags";
import { listPickLists, prismaKeyValueStore } from "@/warehouse/pick-lists";
import { getConfirmedQueue } from "@/warehouse/queue";
import { WarehouseClient } from "./warehouse-client";

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="ওয়্যারহাউস"
        description="পিক → প্যাক → শিপ: কনফার্মড অর্ডারের পিক লিস্ট, প্যাক চেকলিস্ট আর স্ক্যান করে কুরিয়ারে হস্তান্তরের রেকর্ড। পিক লিস্ট সম্পন্ন করা শুধু কর্মীর নিশ্চিতকরণ — এতে স্টক নড়ে না; স্টক অর্ডার তৈরির সময়ই রিজার্ভ হয়েছে।"
      />
      <WarehouseClient initialQueue={queue} initialLists={lists} />
    </div>
  );
}
