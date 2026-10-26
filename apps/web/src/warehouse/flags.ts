/**
 * Warehouse ops flag — ADV-21 (doc 22).
 *
 * Single gate for the whole pick → pack → ship surface: the admin
 * page, every /api/v1/admin/warehouse route and the nav entry all key
 * on `module.warehouse_ops` (seeded OFF — paid add-on). Reads go
 * through the shared feature-flag reader (src/lib/feature-flags.ts),
 * never a local store.
 */
import { isFeatureEnabled } from "@/lib/feature-flags";

export const WAREHOUSE_OPS_FLAG = "module.warehouse_ops";

export function isWarehouseOpsEnabled(): boolean {
  return isFeatureEnabled(WAREHOUSE_OPS_FLAG);
}
