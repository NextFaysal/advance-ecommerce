/**
 * Sales funnel — Agent 15, Step 47 (A8). Pure counting.
 * Conversion between steps is in basis points (10000 = 100%).
 * Steps must be declared in order; counts that go UP between steps
 * (tracking gaps) are reported as-is with conversion capped at 10000 —
 * the raw counts are always returned so the gap is visible, not hidden.
 */

export type FunnelStage = "view" | "cart" | "checkout" | "order";

export interface FunnelCounts {
  view: number;
  cart: number;
  checkout: number;
  order: number;
}

export interface FunnelStep {
  stage: FunnelStage;
  count: number;
  /** Conversion from the previous step, basis points. First step = 10000. */
  conversionFromPreviousBps: number;
  /** Conversion from the first step (view), basis points. */
  conversionFromStartBps: number;
}

const STAGES: FunnelStage[] = ["view", "cart", "checkout", "order"];

export function buildFunnel(counts: FunnelCounts): FunnelStep[] {
  const start = counts.view;
  let previous = 0;
  return STAGES.map((stage, i) => {
    const count = counts[stage];
    const fromPrevious = i === 0 || previous === 0 ? 10000 : Math.min(10000, Math.round((count / previous) * 10000));
    const fromStart = start === 0 ? 0 : Math.min(10000, Math.round((count / start) * 10000));
    previous = count;
    return { stage, count, conversionFromPreviousBps: fromPrevious, conversionFromStartBps: fromStart };
  });
}
