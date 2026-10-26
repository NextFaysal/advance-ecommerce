/**
 * Rental module flag — ADV-23 vertical 3 (doc 22/23, wave 56).
 *
 * Single gate for the whole rental surface: the checkout rental
 * picker, the order-create seams, the public availability API, the
 * admin rentals board and every /api/v1/admin/rentals +
 * /api/v1/admin/rental route key on `module.rental` (seeded OFF —
 * paid add-on). Reads go through the shared feature-flag reader
 * (src/lib/feature-flags.ts), never a local store — the
 * services/flags.ts pattern.
 */
import { isFeatureEnabled } from "@/lib/feature-flags";

export const RENTAL_FLAG = "module.rental";

export function isRentalEnabled(): boolean {
  return isFeatureEnabled(RENTAL_FLAG);
}
