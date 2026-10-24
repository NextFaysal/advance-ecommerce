/**
 * Feature-flag store — Agent 16 (B2B), migrated to the unified reader
 * by Agent 62.
 *
 * This file previously kept its own in-memory demo store. It is now a
 * thin adapter over the ONE unified flag store in src/lib/feature-flags.ts
 * — the same store the feature-flags API PATCHes — so a toggle in
 * Admin > Settings > Feature Flags is visible to the B2B routes and
 * page in the same process. The exported API is unchanged (B2bFlagStore,
 * InMemoryB2bFlagStore, demoB2bFlags, isB2bEnabled), so consumers —
 * src/b2b/guard.ts, the B2B page — keep working untouched; the class
 * now delegates to the shared unified store instead of holding private
 * state.
 *
 * The real flag lives in the DB `feature_flags` table as `module.b2b`
 * (paid v2 add-on, OFF by default; it IS in the seed FEATURE_FLAGS
 * catalogue and in the unified reader's definitions). A locked module
 * returns 403 FEATURE_LOCKED. When the DB-backed source replaces the
 * demo source inside src/lib/feature-flags.ts, this file needs no
 * change.
 */
import { featureFlags } from "../lib/feature-flags";

export type B2bFlagKey = "module.b2b";

export interface B2bFlagStore {
  isEnabled(key: B2bFlagKey): boolean;
  setEnabled(key: B2bFlagKey, enabled: boolean): void;
  list(): Record<B2bFlagKey, boolean>;
}

/** Adapter over the unified flag store (src/lib/feature-flags.ts). */
export class InMemoryB2bFlagStore implements B2bFlagStore {
  isEnabled(key: B2bFlagKey): boolean { return featureFlags.isFeatureEnabled(key); }
  setEnabled(key: B2bFlagKey, enabled: boolean): void { featureFlags.setFeatureEnabled(key, enabled); }
  list(): Record<B2bFlagKey, boolean> { return { "module.b2b": featureFlags.isFeatureEnabled("module.b2b") }; }
}

export const demoB2bFlags: B2bFlagStore = new InMemoryB2bFlagStore();
export function isB2bEnabled(store: B2bFlagStore = demoB2bFlags): boolean {
  return store.isEnabled("module.b2b");
}
