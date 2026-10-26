/**
 * Courier-assignment stats built from REAL shipment history
 * (server-only). Consumers: the bd-tools page (passed to the client
 * panel as plain serializable props) and the order-workspace booking
 * recommendation (src/shipments/assignment-recommendation.ts, ADV-5).
 *
 * Split of sources, stated honestly on the panel:
 *  - HISTORY (delivered / failed / returned counts, per-district rates,
 *    average delivery days) is aggregated here from the Shipment +
 *    ShipmentEvent + Order(district) tables — real rows only.
 *  - CAPABILITIES (active, zones, max weight, COD support, promised
 *    ETA) come from the provider catalogue entries in
 *    src/bd/courier-assignment.ts (SAMPLE_COURIER_STATS) — there is no
 *    provider-capability config anywhere else in the system (sandbox
 *    rate cards cover only steadfast/pathao/redx and are server-only
 *    pricing, not capabilities). A provider that has shipment history
 *    but no catalogue entry is included with generic capability
 *    defaults so its real history is not hidden.
 */
import { prisma } from "@advance-ecommerce/db";
import {
  SAMPLE_COURIER_STATS,
  type CourierAssignmentStats,
  type CourierDistrictStat,
} from "@/bd/courier-assignment";

export interface CourierStatsBuild {
  stats: CourierAssignmentStats[];
  /** Non-deleted shipments the history was aggregated from. */
  shipmentCount: number;
  /** Providers with at least one shipment in the DB. */
  providersWithHistory: number;
}

const TERMINAL = new Set(["DELIVERED", "FAILED", "RETURNED"]);

export async function buildCourierStatsFromDb(): Promise<CourierStatsBuild> {
  const shipments = await prisma.shipment.findMany({
    where: { deletedAt: null },
    select: {
      provider: true,
      status: true,
      createdAt: true,
      order: { select: { district: true } },
      events: {
        where: { status: "DELIVERED" },
        select: { occurredAt: true },
        orderBy: { occurredAt: "asc" },
        take: 1,
      },
    },
  });

  interface Acc {
    delivered: number;
    failed: number;
    returned: number;
    deliveryDaysSum: number;
    deliveryDaysCount: number;
    districts: Map<string, CourierDistrictStat>;
  }
  const byProvider = new Map<string, Acc>();
  const accFor = (provider: string): Acc => {
    let acc = byProvider.get(provider);
    if (!acc) {
      acc = { delivered: 0, failed: 0, returned: 0, deliveryDaysSum: 0, deliveryDaysCount: 0, districts: new Map() };
      byProvider.set(provider, acc);
    }
    return acc;
  };

  for (const s of shipments) {
    const acc = accFor(s.provider);
    if (s.status === "DELIVERED") {
      acc.delivered += 1;
      const deliveredAt = s.events[0]?.occurredAt;
      if (deliveredAt) {
        acc.deliveryDaysSum += (deliveredAt.getTime() - s.createdAt.getTime()) / 86_400_000;
        acc.deliveryDaysCount += 1;
      }
    } else if (s.status === "FAILED") {
      acc.failed += 1;
    } else if (s.status === "RETURNED" || s.status === "RETURNING") {
      acc.returned += 1;
    }
    if (TERMINAL.has(s.status)) {
      const district = s.order.district;
      const d = acc.districts.get(district) ?? { delivered: 0, total: 0 };
      d.total += 1;
      if (s.status === "DELIVERED") d.delivered += 1;
      acc.districts.set(district, d);
    }
  }

  const stats: CourierAssignmentStats[] = SAMPLE_COURIER_STATS.map((cap) => {
    const acc = byProvider.get(cap.provider);
    return {
      ...cap,
      delivered: acc?.delivered ?? 0,
      failed: acc?.failed ?? 0,
      returned: acc?.returned ?? 0,
      avgDeliveryDays:
        acc && acc.deliveryDaysCount > 0
          ? Math.round((acc.deliveryDaysSum / acc.deliveryDaysCount) * 10) / 10
          : null,
      districtStats: acc && acc.districts.size > 0 ? Object.fromEntries(acc.districts) : undefined,
    };
  });

  for (const [provider, acc] of byProvider) {
    if (stats.some((s) => s.provider === provider)) continue;
    stats.push({
      provider,
      active: true,
      supportedZones: ["inside_dhaka", "outside_dhaka", "district"],
      maxWeightGrams: 10000,
      codSupported: true,
      delivered: acc.delivered,
      failed: acc.failed,
      returned: acc.returned,
      avgDeliveryDays:
        acc.deliveryDaysCount > 0
          ? Math.round((acc.deliveryDaysSum / acc.deliveryDaysCount) * 10) / 10
          : null,
      estimatedDays: null,
      districtStats: acc.districts.size > 0 ? Object.fromEntries(acc.districts) : undefined,
    });
  }

  return {
    stats,
    shipmentCount: shipments.length,
    providersWithHistory: byProvider.size,
  };
}
