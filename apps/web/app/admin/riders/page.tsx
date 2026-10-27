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
import { getRequestLocale } from "@/i18n/server";
import { interpolate, pick } from "@/i18n/locale";
import { RIDERS_STRINGS, type RidersStrings } from "./strings";

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
  const locale = await getRequestLocale();
  const s = pick(locale, RIDERS_STRINGS);
  const riderStatusLabel = (status: string): string => {
    const key = (
      {
        ACTIVE: "statusActive",
        INACTIVE: "statusInactive",
        ON_DELIVERY: "statusOnDelivery",
        SUSPENDED: "statusSuspended",
      } as Record<string, keyof RidersStrings>
    )[status];
    return key ? s[key] : status;
  };
  await ensureDbFeatureFlags();
  if (!isRiderEnabled(demoRiderFlags)) {
    return (
      <main>
        <PageHeader title={s.lockedTitle} description={s.lockedDesc} />
        <p role="status">{interpolate(s.lockedText, { flag: "module.rider" })}</p>
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
          {riderStatusLabel(r.status)}
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
      <PageHeader title={s.title} description={s.description} breadcrumb="Admin / Delivery" />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={s.statRiders} value={String(riders.length)} delta={interpolate(s.availableDelta, { count: riders.filter((r) => r.status === "ACTIVE" || r.status === "ON_DELIVERY").length })} icon={<Icon name="users" size={22} />} />
        <StatCard label={s.statInFlight} value={String(inFlight.length)} delta={s.statInFlightDelta} icon={<Icon name="package" size={22} />} />
        <StatCard label={s.statDelivered} value={String(deliveries.filter((d) => d.status === "DELIVERED").length)} delta={s.statDeliveredDelta} icon={<Icon name="check" size={22} />} />
        <StatCard label={s.statCodShortages} value={String(shortageCount)} delta={shortageCount > 0 ? s.shortageNeedsReview : s.shortageNone} deltaTone={shortageCount > 0 ? "down" : "up"} icon={<Icon name="banknote" size={22} />} />
      </div>

      {riders.length === 0 ? (
        <p className="mb-6 rounded-md bg-surface-2 px-3 py-2 text-sm text-text-muted">
          {s.emptyNote}
        </p>
      ) : null}

      <h2 className="mb-3 text-lg font-semibold">{s.ridersHeading}</h2>
      <DataTable
        caption={s.tableCaption}
        columns={[
          { key: "rider", header: s.colRider },
          { key: "phone", header: s.colPhone },
          { key: "zone", header: s.colZone },
          { key: "vehicle", header: s.colVehicle },
          { key: "status", header: s.colStatus },
          { key: "load", header: s.colLoad },
          { key: "delivered", header: s.colDelivered },
          { key: "success", header: s.colSuccess },
          { key: "payout", header: s.colPayout },
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
