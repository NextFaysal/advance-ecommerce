/**
 * VAT report aggregation — Agent 17, Step 49 (A16).
 * Output VAT (on sales) minus input VAT (on purchases) = net payable,
 * grouped by rate. Rows are plain data so the same function serves the
 * admin report and the monthly NBR filing summary.
 */
import type { VatReport, VatRow } from "./types";

export function buildVatReport(rows: VatRow[], fromDate: string, toDate: string): VatReport {
  let outputVatPoisha = 0;
  let inputVatPoisha = 0;
  let salesNetPoisha = 0;
  let purchaseNetPoisha = 0;
  const byRateMap = new Map<number, { salesVatPoisha: number; purchaseVatPoisha: number }>();

  for (const row of rows) {
    if (row.date < fromDate || row.date > toDate) continue;
    if (!Number.isInteger(row.netPoisha) || !Number.isInteger(row.vatPoisha)) {
      throw new Error("VAT rows must use integer poisha.");
    }
    const bucket = byRateMap.get(row.vatRateBps) ?? { salesVatPoisha: 0, purchaseVatPoisha: 0 };
    if (row.kind === "sale") {
      outputVatPoisha += row.vatPoisha;
      salesNetPoisha += row.netPoisha;
      bucket.salesVatPoisha += row.vatPoisha;
    } else {
      inputVatPoisha += row.vatPoisha;
      purchaseNetPoisha += row.netPoisha;
      bucket.purchaseVatPoisha += row.vatPoisha;
    }
    byRateMap.set(row.vatRateBps, bucket);
  }

  return {
    fromDate,
    toDate,
    outputVatPoisha,
    inputVatPoisha,
    netPayablePoisha: outputVatPoisha - inputVatPoisha,
    salesNetPoisha,
    purchaseNetPoisha,
    byRate: [...byRateMap.entries()]
      .map(([vatRateBps, v]) => ({ vatRateBps, salesVatPoisha: v.salesVatPoisha, purchaseVatPoisha: v.purchaseVatPoisha }))
      .sort((a, b) => a.vatRateBps - b.vatRateBps),
  };
}
