/**
 * Services module flag — ADV-23 vertical 2 (doc 22/23, wave 56).
 *
 * Single gate for the whole services + appointment-booking surface:
 * the checkout booking picker, the order-create seams, the public
 * availability API, the admin bookings board and every
 * /api/v1/admin/bookings + /api/v1/admin/services route key on
 * `module.services` (seeded OFF — paid add-on). Reads go through the
 * shared feature-flag reader (src/lib/feature-flags.ts), never a
 * local store — the restaurant/flags.ts pattern.
 */
import { isFeatureEnabled } from "@/lib/feature-flags";

export const SERVICES_FLAG = "module.services";

export function isServicesEnabled(): boolean {
  return isFeatureEnabled(SERVICES_FLAG);
}
