/**
 * Restaurant config — ADV-23 vertical 1 (doc 23, wave 56).
 *
 * Storage: ONE Setting document, key `restaurant.config`, holding
 *   { tables: string[], takeawayEnabled: boolean, dineInEnabled: boolean }
 * written with the established doc-store mechanism (direct
 * prisma.setting.upsert + invalidateSettingCache — the generic
 * setSetting() path rejects keys outside SETTING_DEFAULTS, the same
 * reason templates.* / custom_fields.* docs have their own stores).
 *
 * FAIL-SOFT READS (the config-store.ts contract): a missing doc, a
 * corrupt doc, or a DB error resolves to the code defaults —
 *   tables: [], takeawayEnabled: true, dineInEnabled: true
 * A corrupt config must never take checkout down.
 *
 * EFFECTIVE dine-in: the stored toggle is only half the truth. With
 * ZERO configured tables there is nothing to sit at, so the
 * EFFECTIVE dineInEnabled (what every consumer reads) is
 * `stored && tables.length > 0` — a fresh install with the flag
 * flipped on serves takeaway only until the merchant names tables.
 * The admin config API reports both the stored and effective values
 * so the distinction is never hidden.
 */
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { getSetting, invalidateSettingCache } from "@/lib/settings";
import type { EffectiveRestaurantConfig } from "./selection";

export const RESTAURANT_CONFIG_KEY = "restaurant.config";

/** Table labels: short human labels ("টেবিল ১", "T1", "বারান্দা ২") —
 *  trimmed, non-empty, capped; at most 50 tables per install. */
export const restaurantConfigSchema = z.object({
  tables: z.array(z.string().trim().min(1).max(40)).max(50).default([]),
  takeawayEnabled: z.boolean().default(true),
  dineInEnabled: z.boolean().default(true),
});

export type RestaurantConfig = z.infer<typeof restaurantConfigSchema>;

export const DEFAULT_RESTAURANT_CONFIG: RestaurantConfig = {
  tables: [],
  takeawayEnabled: true,
  dineInEnabled: true,
};

/** De-duplicate labels (first occurrence wins, order preserved) —
 *  two identical labels would make the checkout table select and
 *  the frozen ticket label ambiguous. Applied at save AND at read,
 *  so a hand-edited doc cannot smuggle duplicates in either. */
function dedupeTables(tables: string[]): string[] {
  return [...new Set(tables.map((t) => t.trim()).filter((t) => t !== ""))];
}

export interface LoadedRestaurantConfig {
  /** The stored (or default) document, as saved. */
  config: RestaurantConfig;
  /** "saved" = merchant doc; "default" = code defaults (no doc, or doc failed validation). */
  source: "saved" | "default";
  /** What consumers must honour: dine-in already folded with the tables rule. */
  effective: EffectiveRestaurantConfig;
}

function toLoaded(config: RestaurantConfig, source: "saved" | "default"): LoadedRestaurantConfig {
  const tables = dedupeTables(config.tables);
  return {
    config: { ...config, tables },
    source,
    effective: {
      tables,
      takeawayEnabled: config.takeawayEnabled,
      dineInEnabled: config.dineInEnabled && tables.length > 0,
    },
  };
}

/** The stored config with defaults fallback — never throws. */
export async function loadRestaurantConfig(): Promise<LoadedRestaurantConfig> {
  let raw: string | null = null;
  try {
    raw = await getSetting(RESTAURANT_CONFIG_KEY);
  } catch {
    raw = null;
  }
  if (raw) {
    try {
      const parsed = restaurantConfigSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return toLoaded(parsed.data, "saved");
    } catch {
      // Corrupt JSON — fall through to defaults (documented above).
    }
  }
  return toLoaded(DEFAULT_RESTAURANT_CONFIG, "default");
}

/** Persist a validated config (the admin route validates first).
 *  Throws on DB failure — the route reports 503 rather than
 *  claiming a save that did not happen. */
export async function saveRestaurantConfig(config: RestaurantConfig, actorId: string): Promise<void> {
  const clean: RestaurantConfig = { ...config, tables: dedupeTables(config.tables) };
  const value = JSON.stringify(clean);
  await prisma.setting.upsert({
    where: { key: RESTAURANT_CONFIG_KEY },
    create: {
      key: RESTAURANT_CONFIG_KEY,
      value,
      valueEncrypted: false,
      isPublic: false,
      category: "general",
      description: "Restaurant module config document (JSON, ADV-23)",
      updatedById: actorId,
    },
    update: { value, valueEncrypted: false, updatedById: actorId },
  });
  invalidateSettingCache(RESTAURANT_CONFIG_KEY);
}
