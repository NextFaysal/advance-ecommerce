import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/money";
import { Phone } from "@/components/ui/phone";
import { demoRiderFlags, isRiderEnabled } from "@/riders/flags";
import { demoRiderStore } from "@/riders/store";
import { activeLoad } from "@/riders/assignment";
import { codHandoverLine, computeRiderPerformance } from "@/riders/service";

// Own Riders admin — Agent 18, Step 45 (E3).
// Locked state: while module.rider is OFF (seeded default, paid add-on),
// the page renders the lock panel, matching the API's 403 FEATURE_LOCKED.
// Demo data (in-memory) everywhere else, labelled. Phones masked via the
// design-system <Phone> (masking by default). The assignment board is a
// skeleton: it shows the queue grouped by delivery state and each rider's
// load — assigning is done through POST /api/v1/admin/riders/assign, whose
// pure scoring (nearest stub zone + lowest load) is in src/riders.
export default function AdminRidersPage() {
  if (!isRiderEnabled(demoRiderFlags)) {
    return (
      <main>
        <PageHeader title="Own Riders" description="In-house delivery rider management (E3)" />
        <p role="status">
          🔒 This module is locked for this install. Own rider management is a paid add-on —
          enable <code>module.rider</code> in Admin &gt; Settings &gt; Feature Flags to unlock it.
        </p>
      </main>
    );
  }

  const riders = demoRiderStore.listRiders();
  const deliveries = demoRiderStore.listDeliveries();
  const zoneName = (id: string) => demoRiderStore.listZones().find((z) => z.id === id)?.name ?? id;
  const inFlight = deliveries.filter((d) => d.status === "ASSIGNED" || d.status === "PICKED_UP");
  const shortageCount = deliveries
    .filter((d) => d.status === "DELIVERED")
    .map(codHandoverLine)
    .filter((l) => l.hasShortage).length;

  const riderRows = riders.map((r) => {
    const perf = computeRiderPerformance(r, deliveries);
    return {
      rider: <span className="font-medium">{r.name}</span>,
      phone: <Phone phone={r.phone} />,
      zone: zoneName(r.zoneId),
      vehicle: r.vehicle,
      status: (
        <Badge tone={r.status === "ACTIVE" ? "success" : r.status === "ON_DELIVERY" ? "info" : "neutral"}>
          {r.status}
        </Badge>
      ),
      load: activeLoad(deliveries, r.id),
      delivered: perf.delivered,
      success: `${(perf.successRateBps / 100).toFixed(0)}%`,
      payout: <Money poisha={perf.payoutPoisha} />,
    };
  });

  const boardRows = deliveries.map((d) => ({
    order: <span className="font-mono">{d.orderId}</span>,
    rider: riders.find((r) => r.id === d.riderId)?.name ?? d.riderId,
    zone: zoneName(d.zoneId),
    state: (
      <Badge tone={d.status === "DELIVERED" ? "success" : d.status === "FAILED" ? "danger" : d.status === "PICKED_UP" ? "info" : "warning"}>
        {d.status}
      </Badge>
    ),
    cod: <Money poisha={d.codAmountPoisha} />,
    proof: d.proof ? d.proof.kind : "—",
  }));

  return (
    <main>
      <PageHeader
        title="Own Riders"
        description="Demo data (in-memory, SAMPLE rows) — DB wiring is the follow-up slice. Assignment uses nearest-zone + lowest-load scoring."
        breadcrumb="Admin / Delivery"
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Riders" value={String(riders.length)} delta={`${riders.filter((r) => r.status === "ACTIVE" || r.status === "ON_DELIVERY").length} available`} icon="🛵" />
        <StatCard label="In-flight deliveries" value={String(inFlight.length)} delta="assigned + picked up" icon="📦" />
        <StatCard label="Delivered (demo)" value={String(deliveries.filter((d) => d.status === "DELIVERED").length)} delta="with proof" icon="✓" />
        <StatCard label="COD shortages" value={String(shortageCount)} delta={shortageCount > 0 ? "needs review" : "none flagged"} deltaTone={shortageCount > 0 ? "down" : "up"} icon="৳" />
      </div>

      <h2 className="mb-3 text-lg font-semibold">Riders</h2>
      <DataTable
        caption="Rider list — phone masked, payout is per-delivery rate × delivered"
        columns={[
          { key: "rider", header: "Rider" },
          { key: "phone", header: "Phone" },
          { key: "zone", header: "Zone" },
          { key: "vehicle", header: "Vehicle" },
          { key: "status", header: "Status" },
          { key: "load", header: "Load" },
          { key: "delivered", header: "Delivered" },
          { key: "success", header: "Success" },
          { key: "payout", header: "Payout due" },
        ]}
        rows={riderRows}
      />

      <h2 className="mb-3 mt-8 text-lg font-semibold">Assignment Board (skeleton)</h2>
      <DataTable
        caption="All demo deliveries by state — new assignments are created via the Assign API"
        columns={[
          { key: "order", header: "Order" },
          { key: "rider", header: "Rider" },
          { key: "zone", header: "Zone" },
          { key: "state", header: "State" },
          { key: "cod", header: "COD" },
          { key: "proof", header: "Proof" },
        ]}
        rows={boardRows}
      />
    </main>
  );
}
