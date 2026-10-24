// Sandbox courier zone rates — pure charge math, CLIENT-SAFE.
// Extracted from courier-provider.ts so pure pricing consumers (e.g.
// the auto courier assignment engine in src/bd/courier-assignment.ts,
// which runs inside a client component) can compute the REAL sandbox
// charge without importing the provider module — that module pulls in
// deterministic.ts (node:crypto) and the in-memory sandbox store,
// neither of which can ship to the browser.
// No imports, no state, no clock: same (zone, weightGrams) in => same
// integer poisha out, on server and client alike.

/** Zone base charge in integer poisha, plus a per-500g surcharge above 1kg. */
export const ZONE_BASE_POISHA: Record<string, number> = {
  inside_dhaka: 6000,
  outside_dhaka: 12000,
  district: 10000,
};

export function courierChargePoisha(zone: string, weightGrams: number): number {
  const base = ZONE_BASE_POISHA[zone] ?? 10000;
  const extraUnits = Math.max(0, Math.ceil((weightGrams - 1000) / 500));
  return base + extraUnits * 2000;
}
