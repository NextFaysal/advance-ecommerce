/**
 * Feature-flag store for Automation + Fraud — Agent 13, migrated to the
 * unified reader by Agent 62.
 *
 * This file previously kept its own in-memory demo store. It is now a
 * thin adapter over the ONE unified flag store in src/lib/feature-flags.ts
 * — the same store the feature-flags API PATCHes — so a toggle in
 * Admin > Settings > Feature Flags is visible to the automation /
 * fraud-rules routes and pages in the same process, and no module flag
 * state can drift from the others.
 *
 * The exported API is unchanged (FeatureFlagStore,
 * InMemoryFeatureFlagStore, demoFeatureFlags, FEATURE_FLAG_KEYS), so
 * every consumer — src/automation/guard.ts and the admin pages — keeps
 * working untouched. The class name is kept for compatibility; instances
 * no longer hold private state, they delegate to the shared unified
 * store. The real flags live in the DB `feature_flags` table, seeded OFF
 * by default (`module.automation`, `module.fraud_scoring` — see
 * packages/db/prisma/seed.ts): a locked module returns 403
 * FEATURE_LOCKED, never runs open. When the DB-backed source replaces
 * the demo source inside src/lib/feature-flags.ts, this file needs no
 * change. Do not change the defaults to ON anywhere — paid add-on
 * modules are unlocked per client, not globally.
 */
import { featureFlags } from "../lib/feature-flags";

export type FeatureFlagKey = "module.automation" | "module.fraud_scoring";

export const FEATURE_FLAG_KEYS: readonly FeatureFlagKey[] = [
  "module.automation",
  "module.fraud_scoring",
];

export interface FeatureFlagStore {
  isEnabled(key: FeatureFlagKey): boolean;
  setEnabled(key: FeatureFlagKey, enabled: boolean): void;
  list(): Record<FeatureFlagKey, boolean>;
}

/** Adapter over the unified flag store (src/lib/feature-flags.ts). */
export class InMemoryFeatureFlagStore implements FeatureFlagStore {
  isEnabled(key: FeatureFlagKey): boolean {
    return featureFlags.isFeatureEnabled(key);
  }

  setEnabled(key: FeatureFlagKey, enabled: boolean): void {
    featureFlags.setFeatureEnabled(key, enabled);
  }

  list(): Record<FeatureFlagKey, boolean> {
    return {
      "module.automation": featureFlags.isFeatureEnabled("module.automation"),
      "module.fraud_scoring": featureFlags.isFeatureEnabled("module.fraud_scoring"),
    };
  }
}

/** Shared demo instance used by the automation / fraud-rules API routes. */
export const demoFeatureFlags: FeatureFlagStore = new InMemoryFeatureFlagStore();
