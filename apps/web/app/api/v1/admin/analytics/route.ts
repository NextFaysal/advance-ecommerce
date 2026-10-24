import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { requireFeature } from "@/ai/feature-flag";
import { ANALYTICS_FEATURE_FLAG } from "@/ai/types";
import { dateRangeSchema } from "@/reports/types";
import type { SalesRow } from "@/reports/types";
import { fetchSalesRows } from "@/reports/db-rows";
import { computeRfm, segmentCounts, type CustomerOrderSummary } from "@/analytics/rfm";
import { computeUnitEconomics } from "@/analytics/unit-economics";
import { rankCouriers, type CourierStats } from "@/analytics/performance";
import { aggregateSales } from "@/reports/service";

// GET /api/v1/admin/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD
// Advanced analytics bundle (Step 47, A8) over real order rows from the
// DB (Prisma, Asia/Dhaka dates). RFM recency is measured against the
// latest date IN the data, not wall-clock today — the response notes
// this. Funnel view/cart/checkout counts need storefront tracking
// events, which are not wired yet, so funnel is null with a reason —
// never invented.
// RBAC: reports.view. Flag: module.advanced_analytics.

function daysBetween(a: string, b: string): number {
  return Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86400000));
}

function buildSummaries(rows: SalesRow[]): CustomerOrderSummary[] {
  const latest = rows.reduce((max, r) => (r.date > max ? r.date : max), rows[0]?.date ?? "2000-01-01");
  const byCustomer = new Map<string, { orders: Set<string>; monetary: number; last: string }>();
  for (const r of rows) {
    if (r.status === "CANCELLED") continue;
    const entry = byCustomer.get(r.customerId) ?? { orders: new Set<string>(), monetary: 0, last: r.date };
    entry.orders.add(r.orderId);
    entry.monetary += r.revenuePoisha - r.refundPoisha;
    if (r.date > entry.last) entry.last = r.date;
    byCustomer.set(r.customerId, entry);
  }
  return Array.from(byCustomer.entries()).map(([customerId, v]) => ({
    customerId,
    recencyDays: daysBetween(v.last, latest),
    frequency: v.orders.size,
    monetaryPoisha: v.monetary,
  }));
}

function buildCourierStats(rows: SalesRow[]): CourierStats[] {
  const byCourier = new Map<string, CourierStats>();
  for (const r of rows) {
    if (!r.courier) continue;
    const s = byCourier.get(r.courier) ?? {
      provider: r.courier, shipments: 0, delivered: 0, failed: 0, returned: 0,
      avgDeliveryHours: null, codCollectedPoisha: 0, codExpectedPoisha: 0,
    };
    s.shipments += 1;
    if (r.status === "DELIVERED") { s.delivered += 1; s.codExpectedPoisha += r.revenuePoisha; s.codCollectedPoisha += r.revenuePoisha; }
    if (r.status === "RETURNED" || r.status === "REFUNDED") s.returned += 1;
    if (r.status === "CANCELLED") s.failed += 1;
    byCourier.set(r.courier, s);
  }
  return Array.from(byCourier.values());
}

export async function GET(req: Request) {
  const guard = await requireAdmin("reports.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const flag = await requireFeature(ANALYTICS_FEATURE_FLAG);
  if (!flag.enabled) return NextResponse.json({ error: { code: flag.code, message: flag.message } }, { status: flag.status });
  const url = new URL(req.url);
  const parsed = dateRangeSchema.safeParse({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "INVALID_RANGE", message: "from/to (YYYY-MM-DD) are required, from <= to." } }, { status: 400 });
  }
  const rows = await fetchSalesRows(parsed.data);
  const bundle = aggregateSales(rows, parsed.data, false);
  const rfm = computeRfm(buildSummaries(rows));
  return NextResponse.json({
    data: {
      totals: bundle.totals,
      rfm,
      segments: segmentCounts(rfm),
      unitEconomics: computeUnitEconomics({
        revenuePoisha: bundle.totals.netRevenuePoisha,
        customers: new Set(rows.map((r) => r.customerId)).size,
        adSpendPoisha: 0,
        adAttributedRevenuePoisha: 0,
      }),
      couriers: rankCouriers(buildCourierStats(rows)),
      funnel: null,
    },
    meta: {
      source: "database",
      notes: [
        "RFM recency is measured against the latest date in the data, not today.",
        "Ad spend is not tracked yet, so ROAS/LTV:CAC are null (not zero, not invented).",
        "Funnel is null until storefront view/cart/checkout tracking events are wired.",
        "Courier COD collected is approximated as delivered revenue; shipment-level COD collection is not broken out in sales rows.",
      ],
    },
  });
}
