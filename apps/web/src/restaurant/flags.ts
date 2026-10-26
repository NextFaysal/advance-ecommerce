/**
 * Restaurant module flag — ADV-23 vertical 1 (doc 22/23, wave 56).
 *
 * Single gate for the whole restaurant + KDS surface: the checkout
 * fulfilment choice, the order-create seams, the KDS board page and
 * every /api/v1/admin/kitchen + /api/v1/admin/restaurant route key
 * on `module.restaurant` (seeded OFF — paid add-on). Reads go
 * through the shared feature-flag reader (src/lib/feature-flags.ts),
 * never a local store — the warehouse/flags.ts pattern.
 */
import { isFeatureEnabled } from "@/lib/feature-flags";

export const RESTAURANT_FLAG = "module.restaurant";

export function isRestaurantEnabled(): boolean {
  return isFeatureEnabled(RESTAURANT_FLAG);
}
