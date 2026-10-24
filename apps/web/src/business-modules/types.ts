/**
 * Business-type module packs — Agent 17, Execution Plan Step 49 (Part C).
 *
 * A "pack" is a CONFIG + VALIDATION bundle for one business type. Packs
 * never fork the core: a client enables a pack via its feature flag
 * (`module.<pack>`, seeded OFF, paid add-on) and the pack's config shapes
 * catalog/checkout behaviour through the pure functions in each pack file.
 *
 * Flag store: the pack flag class below is a thin adapter over the ONE
 * unified flag store in src/lib/feature-flags.ts (migrated by Agent 62),
 * defaulting to OFF — the same store the feature-flags API PATCHes, so
 * pack toggles are visible app-wide in the same process. A locked pack
 * returns 403 FEATURE_LOCKED from routes — it never runs open.
 */
import { z } from "zod";
import { featureFlags } from "../lib/feature-flags";

export const BUSINESS_PACK_IDS = [
  "fashion",
  "electronics",
  "grocery",
  "pharmacy",
  "digital_goods",
] as const;

export type BusinessPackId = (typeof BUSINESS_PACK_IDS)[number];

export type BusinessPackFlagKey =
  | "module.fashion"
  | "module.electronics"
  | "module.grocery"
  | "module.pharmacy"
  | "module.digital_goods";

export const PACK_FLAG_KEYS: Record<BusinessPackId, BusinessPackFlagKey> = {
  fashion: "module.fashion",
  electronics: "module.electronics",
  grocery: "module.grocery",
  pharmacy: "module.pharmacy",
  digital_goods: "module.digital_goods",
};

export interface BusinessModulePack<Config> {
  id: BusinessPackId;
  flagKey: BusinessPackFlagKey;
  nameEn: string;
  nameBn: string;
  description: string;
  defaultConfig: Config;
  /** Output is Config; input is unknown (raw JSON, defaults may fill fields). */
  configSchema: z.ZodType<Config, z.ZodTypeDef, unknown>;
}

export type PackValidation =
  | { ok: true }
  | { ok: false; errors: Array<{ field: string; message: string }> };

/* ------------------------------------------------------------------ */
/* Pack feature-flag store — adapter over the unified flag reader      */
/* (src/lib/feature-flags.ts); same interface shape as before.         */
/* ------------------------------------------------------------------ */

export interface PackFlagStore {
  isEnabled(key: BusinessPackFlagKey): boolean;
  setEnabled(key: BusinessPackFlagKey, enabled: boolean): void;
  list(): Record<BusinessPackFlagKey, boolean>;
}

const ALL_PACK_FLAGS: BusinessPackFlagKey[] = [
  "module.fashion",
  "module.electronics",
  "module.grocery",
  "module.pharmacy",
  "module.digital_goods",
];

/** Adapter over the unified flag store (src/lib/feature-flags.ts). */
export class InMemoryPackFlagStore implements PackFlagStore {
  isEnabled(key: BusinessPackFlagKey): boolean {
    return featureFlags.isFeatureEnabled(key);
  }

  setEnabled(key: BusinessPackFlagKey, enabled: boolean): void {
    featureFlags.setFeatureEnabled(key, enabled);
  }

  list(): Record<BusinessPackFlagKey, boolean> {
    return {
      "module.fashion": featureFlags.isFeatureEnabled("module.fashion"),
      "module.electronics": featureFlags.isFeatureEnabled("module.electronics"),
      "module.grocery": featureFlags.isFeatureEnabled("module.grocery"),
      "module.pharmacy": featureFlags.isFeatureEnabled("module.pharmacy"),
      "module.digital_goods": featureFlags.isFeatureEnabled("module.digital_goods"),
    };
  }
}

export const demoPackFlags: PackFlagStore = new InMemoryPackFlagStore();
export const ALL_PACK_FLAG_KEYS = ALL_PACK_FLAGS;
