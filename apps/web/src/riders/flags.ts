/**
 * Feature-flag store — Agent 18 (Own rider management, E3), migrated to
 * the unified reader by Agent 62.
 *
 * This file previously kept its own in-memory demo store. It is now a
 * thin adapter over the ONE unified flag store in src/lib/feature-flags.ts
 * — the same store the feature-flags API PATCHes — so a toggle in
 * Admin > Settings > Feature Flags is visible to the rider routes and
 * page in the same process. The exported API is unchanged (RiderFlagStore,
 * InMemoryRiderFlagStore, demoRiderFlags, isRiderEnabled,
 * RiderModuleLockedError, assertRiderEnabled), so consumers —
 * src/riders/guard.ts, the riders page — keep working untouched; the
 * class now delegates to the shared unified store instead of holding
 * private state.
 *
 * The real flag lives in the DB `feature_flags` table as `module.rider`
 * (seeded OFF — paid v2 add-on; see packages/db/prisma/seed.ts). A
 * locked module returns 403 FEATURE_LOCKED. When the DB-backed source
 * replaces the demo source inside src/lib/feature-flags.ts, this file
 * needs no change.
 */
import { featureFlags } from "../lib/feature-flags";

export type RiderFlagKey = "module.rider";

export interface RiderFlagStore {
  isEnabled(key: RiderFlagKey): boolean;
  setEnabled(key: RiderFlagKey, enabled: boolean): void;
  list(): Record<RiderFlagKey, boolean>;
}

/** Adapter over the unified flag store (src/lib/feature-flags.ts). */
export class InMemoryRiderFlagStore implements RiderFlagStore {
  isEnabled(key: RiderFlagKey): boolean { return featureFlags.isFeatureEnabled(key); }
  setEnabled(key: RiderFlagKey, enabled: boolean): void { featureFlags.setFeatureEnabled(key, enabled); }
  list(): Record<RiderFlagKey, boolean> { return { "module.rider": featureFlags.isFeatureEnabled("module.rider") }; }
}

export const demoRiderFlags: RiderFlagStore = new InMemoryRiderFlagStore();

export function isRiderEnabled(store: RiderFlagStore = demoRiderFlags): boolean {
  return store.isEnabled("module.rider");
}

export class RiderModuleLockedError extends Error {
  readonly code = "FEATURE_LOCKED";
  constructor() {
    super("Module is locked: module.rider is off. It is a paid add-on — enable the feature flag to use it.");
  }
}

export function assertRiderEnabled(store: RiderFlagStore = demoRiderFlags): void {
  if (!store.isEnabled("module.rider")) throw new RiderModuleLockedError();
}
