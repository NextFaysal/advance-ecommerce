/**
 * Advanced Orders page flag — Agent 46, migrated to the unified reader
 * by Agent 60.
 *
 * `module.advanced_orders` IS in the seed FEATURE_FLAGS catalogue
 * (packages/db/prisma/seed.ts, added 2026-10-24 after Agent 43, seeded
 * OFF) and the admin-nav item for this page carries it with a
 * `locked-add-on` badge. This page previously gated on a page-local demo
 * flag; it now reads the ONE unified flag store in
 * src/lib/feature-flags.ts — the same store the feature-flags API
 * PATCHes — so a toggle in Admin > Settings > Feature Flags unlocks
 * this page's panels in the same process. While OFF the page renders
 * the established lock panel (same pattern as automation / fraud /
 * riders / b2b) and none of the demo panels run.
 *
 * When the DB-backed source replaces the demo source inside
 * src/lib/feature-flags.ts, this file needs no change — do NOT flip the
 * default anywhere: paid add-ons are unlocked per client install, never
 * globally.
 */
import { isFeatureEnabled } from "@/lib/feature-flags";

export const ADVANCED_ORDERS_FLAG_KEY = "module.advanced_orders";

/**
 * Page flag descriptor kept for the lock panel's copy. `enabled` is a
 * LIVE read of the unified store (not a page-local constant).
 */
export const demoAdvancedOrdersFlag = {
  key: ADVANCED_ORDERS_FLAG_KEY,
  seededInDb: true,
  get enabled(): boolean {
    return isFeatureEnabled(ADVANCED_ORDERS_FLAG_KEY);
  },
  note: "module.advanced_orders is seeded OFF in the seed FEATURE_FLAGS — this page reads the unified demo flag store in src/lib/feature-flags.ts, the stand-in for the DB flag reader until Prisma wiring lands.",
};

export function isAdvancedOrdersEnabled(): boolean {
  return isFeatureEnabled(ADVANCED_ORDERS_FLAG_KEY);
}
