/**
 * Reseller feature-flag store — Agent 14 (Step 46, A5), migrated to the
 * unified reader by Agent 62.
 *
 * This file previously kept its own in-memory demo store. It is now a
 * thin adapter over the ONE unified flag store in src/lib/feature-flags.ts
 * — the same store the feature-flags API PATCHes — so a toggle in
 * Admin > Settings > Feature Flags is visible to the reseller routes
 * and page in the same process. The exported API is unchanged
 * (ResellerFlagStore, InMemoryResellerFlagStore, demoResellerFlags,
 * isResellerEnabled), so consumers keep working untouched; the class
 * now delegates to the shared unified store instead of holding private
 * state.
 *
 * The real flag lives in the DB `feature_flags` table, seeded OFF by
 * default (`module.reseller` — see packages/db/prisma/seed.ts). A
 * locked module returns 403 FEATURE_LOCKED, never runs open. When the
 * DB-backed source replaces the demo source inside
 * src/lib/feature-flags.ts, this file needs no change.
 */
import { featureFlags } from "../lib/feature-flags";

export type ResellerFlagKey = "module.reseller";

export interface ResellerFlagStore {
  isEnabled(key: ResellerFlagKey): boolean;
  setEnabled(key: ResellerFlagKey, enabled: boolean): void;
  list(): Record<ResellerFlagKey, boolean>;
}

/** Adapter over the unified flag store (src/lib/feature-flags.ts). */
export class InMemoryResellerFlagStore implements ResellerFlagStore {
  isEnabled(key: ResellerFlagKey): boolean {
    return featureFlags.isFeatureEnabled(key);
  }

  setEnabled(key: ResellerFlagKey, enabled: boolean): void {
    featureFlags.setFeatureEnabled(key, enabled);
  }

  list(): Record<ResellerFlagKey, boolean> {
    return { "module.reseller": featureFlags.isFeatureEnabled("module.reseller") };
  }
}

/** Shared demo instance used by the reseller API routes + admin pages. */
export const demoResellerFlags: ResellerFlagStore = new InMemoryResellerFlagStore();

export function isResellerEnabled(store: ResellerFlagStore = demoResellerFlags): boolean {
  return store.isEnabled("module.reseller");
}

/**
 * ADV-12 portal gate: the self-service reseller portal is its OWN flag
 * (module.reseller_portal, seeded OFF) so an install can run the admin
 * reseller module without exposing reseller logins. Read through the
 * same unified store.
 */
export function isResellerPortalEnabled(): boolean {
  return featureFlags.isFeatureEnabled("module.reseller_portal");
}
