/**
 * District order heatmap — ADV-8 (doc 22). Pure aggregation over
 * sales rows: orders + net revenue per district with a relative
 * intensity (0..1 against the busiest district) so the admin page can
 * render an honest "heat" list without a map library. Share is in
 * basis points of the period's orders. Cancelled orders are excluded
 * (same convention as aggregateSales).
 */
import type { SalesRow } from "../reports/types";

export interface DistrictHeat {
  district: string;
  orders: number;
  /** Net revenue (revenue - refunds), integer poisha. */
  revenuePoisha: number;
  /** Share of the period's orders, basis points (10000 = 100%). */
  shareBps: number;
  /** orders / busiest district's orders, 0..1 — drives the heat bar. */
  intensity: number;
}

export function buildDistrictHeatmap(rows: readonly SalesRow[]): DistrictHeat[] {
  const byDistrict = new Map<string, { orders: Set<string>; revenuePoisha: number }>();
  for (const r of rows) {
    if (r.status === "CANCELLED") continue;
    const entry = byDistrict.get(r.district) ?? { orders: new Set<string>(), revenuePoisha: 0 };
    entry.orders.add(r.orderId);
    entry.revenuePoisha += r.revenuePoisha - r.refundPoisha;
    byDistrict.set(r.district, entry);
  }
  const list = Array.from(byDistrict.entries()).map(([district, v]) => ({
    district,
    orders: v.orders.size,
    revenuePoisha: v.revenuePoisha,
  }));
  const totalOrders = list.reduce((sum, d) => sum + d.orders, 0);
  const maxOrders = list.reduce((max, d) => Math.max(max, d.orders), 0);
  return list
    .map((d) => ({
      ...d,
      shareBps: totalOrders > 0 ? Math.round((d.orders / totalOrders) * 10000) : 0,
      intensity: maxOrders > 0 ? d.orders / maxOrders : 0,
    }))
    .sort((a, b) => b.orders - a.orders || a.district.localeCompare(b.district));
}
