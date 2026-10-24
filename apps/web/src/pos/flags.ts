/**
 * POS feature-flag store — Agent 14 (Step 46, A6), migrated to the
 * unified reader by Agent 62.
 *
 * This file previously kept its own in-memory demo store. It is now a
 * thin adapter over the ONE unified flag store in src/lib/feature-flags.ts
 * — the same store the feature-flags API PATCHes — so a toggle in
 * Admin > Settings > Feature Flags is visible to the POS routes and
 * page in the same process. The exported API is unchanged (PosFlagStore,
 * InMemoryPosFlagStore, demoPosFlags, isPosEnabled), so consumers —
 * app/api/v1/admin/pos/guard.ts, src/pos/register.ts, the POS page —
 * keep working untouched; the class now delegates to the shared unified
 * store instead of holding private state.
 *
 * Real flag: DB `feature_flags` key `module.pos`, seeded OFF. Locked
 * module -> its consumers return 403 FEATURE_LOCKED (the gate helper in
 * register.ts is what API and page code call). POS API routes exist
 * (app/api/v1/admin/pos/*, added by Agent 38) and share this flag check
 * + the register.ts pure logic. When the DB-backed source replaces the
 * demo source inside src/lib/feature-flags.ts, this file needs no
 * change.
 */
import { featureFlags } from "../lib/feature-flags";

export type PosFlagKey = "module.pos";

export interface PosFlagStore {
  isEnabled(key: PosFlagKey): boolean;
  setEnabled(key: PosFlagKey, enabled: boolean): void;
  list(): Record<PosFlagKey, boolean>;
}

/** Adapter over the unified flag store (src/lib/feature-flags.ts). */
export class InMemoryPosFlagStore implements PosFlagStore {
  isEnabled(key: PosFlagKey): boolean {
    return featureFlags.isFeatureEnabled(key);
  }

  setEnabled(key: PosFlagKey, enabled: boolean): void {
    featureFlags.setFeatureEnabled(key, enabled);
  }

  list(): Record<PosFlagKey, boolean> {
    return { "module.pos": featureFlags.isFeatureEnabled("module.pos") };
  }
}

export const demoPosFlags: PosFlagStore = new InMemoryPosFlagStore();

export function isPosEnabled(store: PosFlagStore = demoPosFlags): boolean {
  return store.isEnabled("module.pos");
}
