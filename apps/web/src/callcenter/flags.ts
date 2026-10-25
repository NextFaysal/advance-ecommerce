/**
 * Call-center feature-flag store — Agent 14 (Step 46, A10), migrated to
 * the unified reader by Agent 62.
 *
 * This file previously kept its own in-memory demo store. It is now a
 * thin adapter over the ONE unified flag store in src/lib/feature-flags.ts
 * — the same store the feature-flags API PATCHes — so a toggle in
 * Admin > Settings > Feature Flags is visible to the call-center routes
 * and page in the same process. The exported API is unchanged
 * (CallCenterFlagStore, InMemoryCallCenterFlagStore, demoCallCenterFlags,
 * isCallCenterEnabled), so consumers keep working untouched; the class
 * now delegates to the shared unified store instead of holding private
 * state.
 *
 * Real flag: DB `feature_flags` key `module.call_center`, seeded OFF.
 * Locked module -> API routes return 403 FEATURE_LOCKED, never run open.
 * When the DB-backed source replaces the demo source inside
 * src/lib/feature-flags.ts, this file needs no change.
 */
import { featureFlags } from "../lib/feature-flags";

export type CallCenterFlagKey = "module.call_center" | "module.call_center_automation";

export interface CallCenterFlagStore {
  isEnabled(key: CallCenterFlagKey): boolean;
  setEnabled(key: CallCenterFlagKey, enabled: boolean): void;
  list(): Record<CallCenterFlagKey, boolean>;
}

/** Adapter over the unified flag store (src/lib/feature-flags.ts). */
export class InMemoryCallCenterFlagStore implements CallCenterFlagStore {
  isEnabled(key: CallCenterFlagKey): boolean {
    return featureFlags.isFeatureEnabled(key);
  }

  setEnabled(key: CallCenterFlagKey, enabled: boolean): void {
    featureFlags.setFeatureEnabled(key, enabled);
  }

  list(): Record<CallCenterFlagKey, boolean> {
    return {
      "module.call_center": featureFlags.isFeatureEnabled("module.call_center"),
      "module.call_center_automation": featureFlags.isFeatureEnabled("module.call_center_automation"),
    };
  }
}

export const demoCallCenterFlags: CallCenterFlagStore = new InMemoryCallCenterFlagStore();

export function isCallCenterEnabled(store: CallCenterFlagStore = demoCallCenterFlags): boolean {
  return store.isEnabled("module.call_center");
}

/**
 * C4 kill switch: follow-up automation (auto SMS + retry backoff).
 * Seeded OFF, independent of the module flag — flipping it OFF stops
 * every automation decision AND every queued send (the send path
 * re-checks it at fire time) without touching the module itself.
 */
export function isCallCenterAutomationEnabled(
  store: CallCenterFlagStore = demoCallCenterFlags,
): boolean {
  return store.isEnabled("module.call_center_automation");
}
