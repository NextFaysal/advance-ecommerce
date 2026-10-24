/**
 * Feature-flag store — Agent 16 (Multi-vendor), migrated to the unified
 * reader by Agent 62.
 *
 * This file previously kept its own in-memory demo store. It is now a
 * thin adapter over the ONE unified flag store in src/lib/feature-flags.ts
 * — the same store the feature-flags API PATCHes — so a toggle in
 * Admin > Settings > Feature Flags is visible to the vendor service,
 * routes and pages in the same process. The exported API is unchanged
 * (VendorFlagStore, InMemoryVendorFlagStore, demoVendorFlags,
 * VendorModuleLockedError, assertVendorEnabled), so consumers —
 * src/vendors/service.ts, app/api/v1/admin/vendors/guard.ts — keep
 * working untouched; the class now delegates to the shared unified
 * store instead of holding private state.
 *
 * The real flag lives in the DB `feature_flags` table as
 * `module.multi_vendor` (seeded OFF — paid v2 add-on). When the
 * DB-backed source replaces the demo source inside
 * src/lib/feature-flags.ts, this file needs no change.
 */
import { featureFlags } from "../lib/feature-flags";

export type VendorFlagKey = "module.multi_vendor";

export interface VendorFlagStore {
  isEnabled(key: VendorFlagKey): boolean;
  setEnabled(key: VendorFlagKey, enabled: boolean): void;
  list(): Record<VendorFlagKey, boolean>;
}

/** Adapter over the unified flag store (src/lib/feature-flags.ts). */
export class InMemoryVendorFlagStore implements VendorFlagStore {
  isEnabled(key: VendorFlagKey): boolean { return featureFlags.isFeatureEnabled(key); }
  setEnabled(key: VendorFlagKey, enabled: boolean): void { featureFlags.setFeatureEnabled(key, enabled); }
  list(): Record<VendorFlagKey, boolean> { return { "module.multi_vendor": featureFlags.isFeatureEnabled("module.multi_vendor") }; }
}

export const demoVendorFlags: VendorFlagStore = new InMemoryVendorFlagStore();

export class VendorModuleLockedError extends Error {
  readonly code = "FEATURE_LOCKED";
  constructor() {
    super("Module is locked: module.multi_vendor is off. It is a paid add-on — enable the feature flag to use it.");
  }
}

export function assertVendorEnabled(store: VendorFlagStore = demoVendorFlags): void {
  if (!store.isEnabled("module.multi_vendor")) throw new VendorModuleLockedError();
}
