/**
 * Advanced Orders page flag — Agent 46, migrated to the unified reader
 * by Agent 60; DB hydration added by W0-D (doc 21).
 *
 * `module.advanced_orders` IS in the seed FEATURE_FLAGS catalogue
 * (packages/db/prisma/seed.ts, added 2026-10-24 after Agent 43, seeded
 * OFF) and the admin-nav item for this page carries it with a
 * `locked-add-on` badge. The page reads the ONE unified flag store in
 * src/lib/feature-flags.ts — the same store the feature-flags API
 * PATCHes — and page.tsx calls `ensureDbFeatureFlags()` first (the
 * wave-28 cold-process hydration), so the value it reads is the
 * DB-persisted one: a toggle in Admin > Settings > Feature Flags
 * unlocks this page, in this process and after restarts. While OFF
 * the page renders the established lock panel (same pattern as
 * automation / fraud / riders / b2b) and none of the panels run.
 *
 * Do NOT flip the default anywhere: paid add-ons are unlocked per
 * client install, never globally.
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
  note: "module.advanced_orders is seeded OFF in the seed FEATURE_FLAGS and read from the DB-backed flag store (hydrated per request by ensureDbFeatureFlags).",
};

export function isAdvancedOrdersEnabled(): boolean {
  return isFeatureEnabled(ADVANCED_ORDERS_FLAG_KEY);
}
