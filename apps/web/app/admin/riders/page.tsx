import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/money";
import { Phone } from "@/components/ui/phone";
import { Icon } from "@/components/ui/icon";
import { demoRiderFlags, isRiderEnabled } from "@/riders/flags";
import { riderStore } from "@/riders/db-store";
import { activeLoad } from "@/riders/assignment";
import { codHandoverLine, computeRiderPerformance } from "@/riders/service";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { RiderAssignmentBoard } from "@/components/admin/rider-assignment-board";

// Own Riders admin — Agent 18, Step 45 (E3); real data wired 2026-10-25.
// Locked state: while module.rider is OFF in the feature_flags TABLE
// (seeded default, paid add-on), the page renders the lock panel,
// matching the API's 403 FEATURE_LOCKED. demoRiderFlags delegates to the
// unified flag reader, hydrated from the DB below — so the gate is the
// real flag state, and the data is the Prisma riderStore (Rider +
// RiderDelivery tables, the same store the riders API serves). Zone
// NAMES come from the module's fixed zone catalogue (there is no Zone
// table — Rider.zone is a free string column). Phones masked via the
// design-system <Phone>.
export const dynamic = "force-dynamic";

export default async function AdminRidersPage() {
  await ensureDbFeatureFlags();
  if (!isRiderEnabled(demoRiderFlags)) {
    return (
      <main>
        <PageHeader title="Own Riders" description="In-house delivery rider management (E3)" />
        <p role="status">
          This module is locked for this install. Own rider management is a paid add-on —
          enable <code>module.rider</code> in Admin &gt; Settings &gt; Feature Flags to unlock it.
        </p>
      </main>
    );
  }

  const [riders, deliveries] = await Promise.all([
    riderStore.listRiders(),
    riderStore.listDeliveries(),
  ]);
  const zones = riderStore.listZones();
  const zoneName = (id: string) => zones.find((z) => z.id === id)?.name ?? id;
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

  const assignmentViews = deliveries.map((d) => ({
    id: d.id,
    orderId: d.orderId,
    riderId: d.riderId,
    riderName: riders.find((r) => r.id === d.riderId)?.name ?? d.riderId,
    zoneName: zoneName(d.zoneId),
    status: d.status,
    codAmountPoisha: d.codAmountPoisha,
    proofKind: d.proof ? d.proof.kind : "—",
  }));

  return (
    <main>
      <PageHeader
        title="Own Riders"
        description="Real data from the Rider and RiderDelivery tables (same store as the riders API). Zone names are the module's fixed catalogue — there is no Zone table. Assignment uses nearest-zone + lowest-load scoring."
        breadcrumb="Admin / Delivery"
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Riders" value={String(riders.length)} delta={`${riders.filter((r) => r.status === "ACTIVE" || r.status === "ON_DELIVERY").length} available`} icon={<Icon name="users" size={22} />} />
        <StatCard label="In-flight deliveries" value={String(inFlight.length)} delta="assigned + picked up" icon={<Icon name="package" size={22} />} />
        <StatCard label="Delivered" value={String(deliveries.filter((d) => d.status === "DELIVERED").length)} delta="with proof" icon={<Icon name="check" size={22} />} />
        <StatCard label="COD shortages" value={String(shortageCount)} delta={shortageCount > 0 ? "needs review" : "none flagged"} deltaTone={shortageCount > 0 ? "down" : "up"} icon={<Icon name="banknote" size={22} />} />
      </div>

      {riders.length === 0 ? (
        <p className="mb-6 rounded-md bg-surface-2 px-3 py-2 text-sm text-text-muted">
          No riders are registered yet — riders added via the riders API will appear here with their
          delivery history. The tables below are empty because the tables are empty, not sample data.
        </p>
      ) : null}

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

      <div className="mt-8">
        <RiderAssignmentBoard
          initialDeliveries={assignmentViews}
          riders={riders.map((r) => ({ id: r.id, name: r.name, status: r.status }))}
        />
      </div>
    </main>
  );
}
