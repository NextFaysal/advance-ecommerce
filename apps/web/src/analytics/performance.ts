/**
 * Courier + staff performance — Agent 15, Step 47 (A8). Pure scoring.
 * Scores are 0–100 integers built from rates in basis points, so the
 * inputs stay exact. The formula is documented in-code and returned in
 * `breakdown` — staff/couriers can see exactly why a score moved.
 */

export interface CourierStats {
  provider: string;
  shipments: number;
  delivered: number;
  failed: number;
  returned: number;
  /** Average delivery time in hours; null when unknown. */
  avgDeliveryHours: number | null;
  /** COD collected, integer poisha. */
  codCollectedPoisha: number;
  /** COD expected, integer poisha. */
  codExpectedPoisha: number;
}

export interface CourierScore {
  provider: string;
  deliveryRateBps: number;
  returnRateBps: number;
  codCollectionBps: number;
  /** 0–100: 50% delivery rate, 25% low returns, 25% COD collection. */
  score: number;
  breakdown: string;
}

export function scoreCourier(stats: CourierStats): CourierScore {
  const total = Math.max(1, stats.shipments);
  const deliveryRateBps = Math.round((stats.delivered / total) * 10000);
  const returnRateBps = Math.round((stats.returned / total) * 10000);
  const codCollectionBps = stats.codExpectedPoisha > 0
    ? Math.round((stats.codCollectedPoisha / stats.codExpectedPoisha) * 10000)
    : 10000;
  const score = Math.max(0, Math.min(100, Math.round(
    (deliveryRateBps / 10000) * 50 + ((10000 - returnRateBps) / 10000) * 25 + (codCollectionBps / 10000) * 25,
  )));
  return {
    provider: stats.provider,
    deliveryRateBps,
    returnRateBps,
    codCollectionBps,
    score,
    breakdown: `delivery ${(deliveryRateBps / 100).toFixed(1)}% x50, returns ${(returnRateBps / 100).toFixed(1)}% (lower is better) x25, COD collection ${(codCollectionBps / 100).toFixed(1)}% x25`,
  };
}

export function rankCouriers(stats: CourierStats[]): CourierScore[] {
  return stats.map(scoreCourier).sort((a, b) => b.score - a.score);
}

/* ---- Staff ---- */

export interface StaffStats {
  staffId: string;
  name: string;
  ordersProcessed: number;
  ordersConfirmed: number;
  callsHandled: number;
  /** Tasks finished within SLA, and total SLA-tracked tasks. */
  slaMet: number;
  slaTotal: number;
}

export interface StaffScore {
  staffId: string;
  name: string;
  confirmRateBps: number;
  slaRateBps: number;
  ordersProcessed: number;
}

export function staffPerformance(stats: StaffStats[]): StaffScore[] {
  return stats
    .map((s) => ({
      staffId: s.staffId,
      name: s.name,
      confirmRateBps: s.ordersProcessed > 0 ? Math.round((s.ordersConfirmed / s.ordersProcessed) * 10000) : 0,
      slaRateBps: s.slaTotal > 0 ? Math.round((s.slaMet / s.slaTotal) * 10000) : 0,
      ordersProcessed: s.ordersProcessed,
    }))
    .sort((a, b) => b.ordersProcessed - a.ordersProcessed);
}
