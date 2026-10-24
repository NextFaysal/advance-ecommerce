/**
 * Unit economics — Agent 15, Step 47 (A8).
 * All money inputs/outputs are integer poisha. Ratios that would normally
 * be floats (LTV:CAC, ROAS) are returned in BASIS POINTS (10000 = 1.0x)
 * so no float money is ever stored; division-by-zero returns null with
 * the reason in the field, never Infinity.
 */

export interface UnitEconomicsInput {
  /** Total net revenue attributed to the cohort, integer poisha. */
  revenuePoisha: number;
  /** Distinct customers acquired in the window. */
  customers: number;
  /** Total marketing spend, integer poisha. */
  adSpendPoisha: number;
  /** Revenue attributed to ads, integer poisha. */
  adAttributedRevenuePoisha: number;
}

export interface UnitEconomics {
  /** Average revenue per customer, integer poisha (rounded). */
  ltvPoisha: number;
  /** Ad spend per acquired customer, integer poisha (rounded). */
  cacPoisha: number;
  /** LTV / CAC in basis points; null when CAC is 0. */
  ltvToCacBps: number | null;
  /** Ad revenue / ad spend in basis points; null when spend is 0. */
  roasBps: number | null;
}

export function computeUnitEconomics(input: UnitEconomicsInput): UnitEconomics {
  const ltvPoisha = input.customers > 0 ? Math.round(input.revenuePoisha / input.customers) : 0;
  const cacPoisha = input.customers > 0 ? Math.round(input.adSpendPoisha / input.customers) : 0;
  return {
    ltvPoisha,
    cacPoisha,
    ltvToCacBps: cacPoisha > 0 ? Math.round((ltvPoisha / cacPoisha) * 10000) : null,
    roasBps: input.adSpendPoisha > 0 ? Math.round((input.adAttributedRevenuePoisha / input.adSpendPoisha) * 10000) : null,
  };
}

/** AOV in integer poisha; 0 orders -> 0 (documented, not an average). */
export function averageOrderValuePoisha(revenuePoisha: number, orders: number): number {
  return orders > 0 ? Math.round(revenuePoisha / orders) : 0;
}
