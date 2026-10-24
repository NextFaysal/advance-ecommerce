// Reports service — Agent 10. Pure aggregation, integer poisha only.
// Input rows come from orders/order_items (DB owner, pending Prisma generate);
// this service never trusts client-side totals — callers must pass rows built
// from the pricing pipeline's stored poisha fields.
import type { DateRange, ReportBundle, SalesRow, Totals } from "./types";

function emptyTotals(): Totals {
  return { orders: 0, units: 0, revenuePoisha: 0, costPoisha: 0, shippingPoisha: 0, refundPoisha: 0, grossProfitPoisha: 0, netRevenuePoisha: 0 };
}
function addRow(t: Totals, r: SalesRow, orderIds: Set<string>): void {
  if (!orderIds.has(r.orderId)) { t.orders += 1; orderIds.add(r.orderId); }
  t.units += r.quantity;
  t.revenuePoisha += r.revenuePoisha;
  t.costPoisha += r.costPoisha;
  t.shippingPoisha += r.shippingPoisha;
  t.refundPoisha += r.refundPoisha;
}
function finalize(t: Totals): Totals {
  return { ...t, grossProfitPoisha: t.revenuePoisha - t.costPoisha, netRevenuePoisha: t.revenuePoisha - t.refundPoisha };
}
function bucket(rows: SalesRow[], keyFn: (r: SalesRow) => string): Record<string, Totals> {
  const out: Record<string, Totals> = {};
  const seen: Record<string, Set<string>> = {};
  for (const r of rows) {
    const k = keyFn(r);
    if (!out[k]) { out[k] = emptyTotals(); seen[k] = new Set<string>(); }
    addRow(out[k] as Totals, r, seen[k] as Set<string>);
  }
  for (const k of Object.keys(out)) out[k] = finalize(out[k] as Totals);
  return out;
}
export function previousRange(range: DateRange): DateRange {
  const from = new Date(`${range.from}T00:00:00Z`);
  const to = new Date(`${range.to}T00:00:00Z`);
  const days = Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
  const prevTo = new Date(from.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(prevFrom), to: fmt(prevTo) };
}
export function aggregateSales(rows: SalesRow[], range: DateRange, includeComparison: boolean): ReportBundle {
  const inRange = rows.filter((r) => r.date >= range.from && r.date <= range.to && r.status !== "CANCELLED");
  const totalsSet = new Set<string>();
  const totals = emptyTotals();
  for (const r of inRange) addRow(totals, r, totalsSet);
  const done = finalize(totals);
  let comparison: ReportBundle["comparison"] = null;
  if (includeComparison) {
    const prev = previousRange(range);
    const prevRows = rows.filter((r) => r.date >= prev.from && r.date <= prev.to && r.status !== "CANCELLED");
    const pt = emptyTotals(); const ps = new Set<string>();
    for (const r of prevRows) addRow(pt, r, ps);
    const pDone = finalize(pt);
    comparison = { previous: pDone, revenueDeltaPercent: pDone.revenuePoisha === 0 ? null : Math.round(((done.revenuePoisha - pDone.revenuePoisha) / pDone.revenuePoisha) * 1000) / 10 };
  }
  return {
    range,
    totals: done,
    byProduct: bucket(inRange, (r) => r.productId),
    byCustomer: bucket(inRange, (r) => r.customerId),
    byCourier: bucket(inRange, (r) => r.courier ?? "unassigned"),
    byDistrict: bucket(inRange, (r) => r.district),
    comparison,
  };
}
const CSV_HEADER = "key,orders,units,revenuePoisha,costPoisha,shippingPoisha,refundPoisha,grossProfitPoisha,netRevenuePoisha";
function csvEscape(v: string): string { return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }
export function totalsToCsv(section: string, data: Record<string, Totals>): string {
  const lines = [CSV_HEADER];
  for (const [key, t] of Object.entries(data)) {
    lines.push([csvEscape(`${section}:${key}`), t.orders, t.units, t.revenuePoisha, t.costPoisha, t.shippingPoisha, t.refundPoisha, t.grossProfitPoisha, t.netRevenuePoisha].join(","));
  }
  return lines.join("\n") + "\n";
}
export function reportToCsv(bundle: ReportBundle): string {
  return [
    totalsToCsv("total", { total: bundle.totals }),
    totalsToCsv("product", bundle.byProduct),
    totalsToCsv("district", bundle.byDistrict),
    totalsToCsv("courier", bundle.byCourier),
  ].join("");
}
