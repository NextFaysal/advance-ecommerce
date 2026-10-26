/**
 * Business pack registry — Agent 17, Step 49 (Part C).
 * One list of all packs, config validation that accepts `unknown` input
 * (routes pass raw JSON), and the flag gate helper. A pack's functions
 * must only run when isPackEnabled() is true for its flag.
 */
import type { BusinessModulePack, BusinessPackFlagKey, BusinessPackId, PackFlagStore, PackValidation } from "./types";
import { demoPackFlags, PACK_FLAG_KEYS } from "./types";
import { fashionPack, type FashionConfig } from "./fashion";
import { electronicsPack, type ElectronicsConfig } from "./electronics";
import { groceryPack, type GroceryConfig } from "./grocery";
import { pharmacyPack, type PharmacyConfig } from "./pharmacy";
import { digitalPack, type DigitalConfig } from "./digital";

export type AnyPackConfig = FashionConfig | ElectronicsConfig | GroceryConfig | PharmacyConfig | DigitalConfig;

export const ALL_PACKS: Array<BusinessModulePack<AnyPackConfig>> = [
  fashionPack as BusinessModulePack<AnyPackConfig>,
  electronicsPack as BusinessModulePack<AnyPackConfig>,
  groceryPack as BusinessModulePack<AnyPackConfig>,
  pharmacyPack as BusinessModulePack<AnyPackConfig>,
  digitalPack as BusinessModulePack<AnyPackConfig>,
];

export function getPack(id: BusinessPackId): BusinessModulePack<AnyPackConfig> | null {
  return ALL_PACKS.find((p) => p.id === id) ?? null;
}

export function isPackEnabled(id: BusinessPackId, store: PackFlagStore = demoPackFlags): boolean {
  return store.isEnabled(PACK_FLAG_KEYS[id]);
}

/** Validate raw (unknown) config JSON for a pack; returns typed config when ok. */
export function validatePackConfig(
  id: BusinessPackId,
  rawConfig: unknown,
): { ok: true; config: AnyPackConfig } | { ok: false; errors: Array<{ field: string; message: string }> } {
  const pack = getPack(id);
  if (!pack) return { ok: false, errors: [{ field: "pack", message: "Unknown business pack." }] };
  const parsed = pack.configSchema.safeParse(rawConfig);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    };
  }
  return { ok: true, config: parsed.data };
}

export function flagKeyForPack(id: BusinessPackId): BusinessPackFlagKey {
  return PACK_FLAG_KEYS[id];
}

/**
 * ADV-22 category matching rule (one rule for every pack): a product
 * category belongs to a pack when its slug EQUALS a configured slug,
 * or ENDS WITH "-<configured>" — the second clause exists so the
 * seeded demo categories (demo-grocery, demo-fashion, demo-electronics,
 * demo-pharmacy) resolve to their packs out of the box, while a real
 * merchant category only matches when the merchant lists its slug (or
 * a slug it is a "-"-suffixed child of) in the pack config.
 */
export function packCategoryMatches(configuredSlugs: readonly string[], categorySlug: string): boolean {
  return configuredSlugs.some((s) => categorySlug === s || categorySlug.endsWith(`-${s}`));
}

export type { PackValidation };
