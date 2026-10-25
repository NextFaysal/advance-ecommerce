/**
 * Pure display helpers for the call-center reports page (CD3, doc 20).
 *
 * These functions ONLY shape numbers the report payload already
 * carries (src/callcenter/reports.ts) into bar widths / ratios for
 * presentation. No figure is computed here that the read model did
 * not already produce — widths are proportions OF payload values,
 * guarded so an empty denominator yields 0, never NaN.
 */

/** Volume ratio 0..1 for the by-hour heat strip. `rawMax` is the
 *  largest bucket value (the page passes the same Math.max(1, …)
 *  guard the old bar chart used). */
export function heatRatio(attempts: number, rawMax: number): number {
  const max = Math.max(1, rawMax);
  if (attempts <= 0) return 0;
  return Math.min(1, attempts / max);
}

/** Percentage 0..100 of `part` within `total`; 0 when total is empty. */
export function sharePct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, (part / total) * 100);
}

export interface OutcomeMixSegment {
  key: "confirmed" | "callbacks" | "cancelled" | "noAnswer" | "wrongNumber";
  /** Raw count from the agentPerformance() payload — passed through. */
  value: number;
  /** Width % of the agent's total calls. */
  pct: number;
}

/** Outcome mix of one agent row, in display order. Segments partition
 *  the agent's totalCalls (agentPerformance counts every log once),
 *  so the widths sum to 100 whenever totalCalls > 0. */
export function outcomeMix(agent: {
  totalCalls: number;
  confirmed: number;
  callbacks: number;
  cancelled: number;
  noAnswer: number;
  wrongNumber: number;
}): OutcomeMixSegment[] {
  const parts: { key: OutcomeMixSegment["key"]; value: number }[] = [
    { key: "confirmed", value: agent.confirmed },
    { key: "callbacks", value: agent.callbacks },
    { key: "cancelled", value: agent.cancelled },
    { key: "noAnswer", value: agent.noAnswer },
    { key: "wrongNumber", value: agent.wrongNumber },
  ];
  return parts.map((p) => ({ ...p, pct: sharePct(p.value, agent.totalCalls) }));
}
