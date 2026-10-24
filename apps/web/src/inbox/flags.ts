/**
 * F-commerce inbox feature-flag store — Agent 14 (Step 46, A6/G),
 * migrated to the unified reader by Agent 62.
 *
 * This file previously kept its own in-memory demo store. It is now a
 * thin adapter over the ONE unified flag store in src/lib/feature-flags.ts
 * — the same store the feature-flags API PATCHes — so a toggle in
 * Admin > Settings > Feature Flags is visible to the inbox routes and
 * page in the same process. The exported API is unchanged (InboxFlagStore,
 * InMemoryInboxFlagStore, demoInboxFlags, isInboxEnabled), so consumers
 * keep working untouched; the class now delegates to the shared unified
 * store instead of holding private state.
 *
 * Real flag: DB `feature_flags` key `module.f_commerce`, seeded OFF.
 * Locked module -> API routes return 403 FEATURE_LOCKED, never run open.
 * When the DB-backed source replaces the demo source inside
 * src/lib/feature-flags.ts, this file needs no change.
 */
import { featureFlags } from "../lib/feature-flags";

export type InboxFlagKey = "module.f_commerce";

export interface InboxFlagStore {
  isEnabled(key: InboxFlagKey): boolean;
  setEnabled(key: InboxFlagKey, enabled: boolean): void;
  list(): Record<InboxFlagKey, boolean>;
}

/** Adapter over the unified flag store (src/lib/feature-flags.ts). */
export class InMemoryInboxFlagStore implements InboxFlagStore {
  isEnabled(key: InboxFlagKey): boolean {
    return featureFlags.isFeatureEnabled(key);
  }

  setEnabled(key: InboxFlagKey, enabled: boolean): void {
    featureFlags.setFeatureEnabled(key, enabled);
  }

  list(): Record<InboxFlagKey, boolean> {
    return { "module.f_commerce": featureFlags.isFeatureEnabled("module.f_commerce") };
  }
}

export const demoInboxFlags: InboxFlagStore = new InMemoryInboxFlagStore();

export function isInboxEnabled(store: InboxFlagStore = demoInboxFlags): boolean {
  return store.isEnabled("module.f_commerce");
}
