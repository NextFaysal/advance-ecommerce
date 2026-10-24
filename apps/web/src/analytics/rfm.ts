/**
 * RFM segmentation — Agent 15, Step 47 (A8). Pure, deterministic.
 * Input is an order summary per customer (the caller builds it from the
 * orders table / SalesRow grouping — this module does no DB work).
 * Scores are quintile-style 1–5 computed against the input population
 * (with small populations everyone shares bands — documented, not hidden).
 * Money: monetary value is integer poisha end to end.
 */

export interface CustomerOrderSummary {
  customerId: string;
  /** Days since the customer's most recent order, >= 0. */
  recencyDays: number;
  /** Completed order count in the window. */
  frequency: number;
  /** Total spend in the window, integer poisha. */
  monetaryPoisha: number;
}

export type RfmSegment =
  | "champions" | "loyal" | "potential" | "new"
  | "at_risk" | "hibernating" | "lost" | "regular";

export interface RfmResult {
  customerId: string;
  r: number;
  f: number;
  m: number;
  segment: RfmSegment;
  monetaryPoisha: number;
}

function band(value: number, sortedAsc: number[], invert: boolean): number {
  if (sortedAsc.length === 0) return 1;
  const rank = sortedAsc.filter((v) => v < value).length;
  const quintile = Math.min(4, Math.floor((rank / sortedAsc.length) * 5));
  return invert ? 5 - quintile : quintile + 1;
}

function segmentFor(r: number, f: number, m: number): RfmSegment {
  if (r >= 4 && f >= 4 && m >= 4) return "champions";
  if (f >= 4 && r >= 3) return "loyal";
  if (r >= 4 && f <= 1) return "new";
  if (r >= 3 && f >= 2) return "potential";
  if (r === 2 && f >= 3) return "at_risk";
  if (r === 1 && f >= 3) return "hibernating";
  if (r === 1) return "lost";
  return "regular";
}

export function computeRfm(customers: CustomerOrderSummary[]): RfmResult[] {
  const recencies = customers.map((c) => c.recencyDays).sort((a, b) => a - b);
  const frequencies = customers.map((c) => c.frequency).sort((a, b) => a - b);
  const monetaries = customers.map((c) => c.monetaryPoisha).sort((a, b) => a - b);
  return customers.map((c) => {
    const r = band(c.recencyDays, recencies, true);
    const f = band(c.frequency, frequencies, false);
    const m = band(c.monetaryPoisha, monetaries, false);
    return { customerId: c.customerId, r, f, m, segment: segmentFor(r, f, m), monetaryPoisha: c.monetaryPoisha };
  });
}

export function segmentCounts(results: RfmResult[]): Record<RfmSegment, number> {
  const out: Record<RfmSegment, number> = {
    champions: 0, loyal: 0, potential: 0, new: 0, at_risk: 0, hibernating: 0, lost: 0, regular: 0,
  };
  for (const r of results) out[r.segment] += 1;
  return out;
}
