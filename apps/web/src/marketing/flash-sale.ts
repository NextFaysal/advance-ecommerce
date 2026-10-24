// Flash sale types — Agent 5, Step 25 (types only).
// Invariant: soldCount must never exceed stockCap. The Step 25 service enforces this
// inside a transaction; this type only carries the rule.

export interface FlashSale {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  stockCap: number;
  soldCount: number;
  isActive: boolean;
}

export function isFlashSaleLive(sale: FlashSale, nowIso: string): boolean {
  return sale.isActive && sale.startsAt <= nowIso && nowIso <= sale.endsAt && sale.soldCount < sale.stockCap;
}

export function remainingFlashStock(sale: FlashSale): number {
  return Math.max(0, sale.stockCap - sale.soldCount);
}
