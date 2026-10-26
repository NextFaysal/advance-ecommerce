/**
 * Print-on-demand module flag — ADV-23 vertical 5 (doc 22/23,
 * wave 56).
 *
 * Single gate for the whole POD surface: the checkout print-text
 * section, the order-create seams, the public config API, the
 * admin print queue and every /api/v1/admin/pod route key on
 * `module.print_on_demand` (seeded OFF — paid add-on). Reads go
 * through the shared feature-flag reader
 * (src/lib/feature-flags.ts), never a local store — the
 * rental/flags.ts pattern.
 */
import { isFeatureEnabled } from "@/lib/feature-flags";

export const POD_FLAG = "module.print_on_demand";

export function isPodEnabled(): boolean {
  return isFeatureEnabled(POD_FLAG);
}
