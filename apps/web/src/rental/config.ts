/**
 * Rental config — ADV-23 vertical 3 (doc 23, wave 56).
 *
 * Storage: ONE Setting document, key `rental.config`, holding
 *   { rentalVariantIds, maxRentalDays, depositMode,
 *     depositFixedPoisha, depositPercentBps, lateFeePerDayPoisha }
 * written with the established doc-store mechanism (direct
 * prisma.setting.upsert + invalidateSettingCache — the generic
 * setSetting() path rejects keys outside SETTING_DEFAULTS, the
 * same reason services.config / restaurant.config docs have their
 * own stores).
 *
 * FAIL-SOFT READS (the config-store.ts contract): a missing doc, a
 * corrupt doc, or a DB error resolves to the code defaults —
 *   NO rentable variants (the fail-soft default can never invent a
 *   rental), 30 max days, deposit mode "none" (a corrupt doc can
 *   never invent a charge), all amounts 0.
 *
 * `lateFeePerDayPoisha` is stored config ONLY in v1: it is shown
 * to staff as the contractual per-day late fee, but nothing
 * charges it automatically — there is no late-fee flow in v1.
 */
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { getSetting, invalidateSettingCache } from "@/lib/settings";
import type { EffectiveRentalConfig } from "./selection";

export const RENTAL_CONFIG_KEY = "rental.config";

/** The plain object schema (no refinements) — the admin config
 *  route extends THIS with its `reason` field. */
export const rentalConfigObjectSchema = z.object({
  /** The v1 "what is rentable" marker — see selection.ts. */
  rentalVariantIds: z.array(z.string().trim().min(1)).max(200).default([]),
  /** Longest single rental, in inclusive days. */
  maxRentalDays: z.number().int().min(1).max(365).default(30),
  /** How the security deposit is derived at order time. */
  depositMode: z.enum(["none", "fixed", "percent"]).default("none"),
  /** Flat deposit per rental (poisha) when depositMode = "fixed". */
  depositFixedPoisha: z.number().int().min(0).max(100_000_000).default(0),
  /** Deposit as a share of the rental line's price (basis points)
   *  when depositMode = "percent". */
  depositPercentBps: z.number().int().min(0).max(10000).default(0),
  /** Contractual late fee per day (poisha) — CONFIG ONLY in v1,
   *  never auto-charged. */
  lateFeePerDayPoisha: z.number().int().min(0).max(100_000_000).default(0),
});

export const rentalConfigSchema = rentalConfigObjectSchema;

export type RentalConfig = z.infer<typeof rentalConfigObjectSchema>;

export const DEFAULT_RENTAL_CONFIG: RentalConfig = {
  rentalVariantIds: [],
  maxRentalDays: 30,
  depositMode: "none",
  depositFixedPoisha: 0,
  depositPercentBps: 0,
  lateFeePerDayPoisha: 0,
};

/** De-duplicate the variant list (first occurrence wins), applied
 *  at save AND at read so a hand-edited doc cannot smuggle
 *  duplicates in either. */
function clean(config: RentalConfig): RentalConfig {
  return {
    ...config,
    rentalVariantIds: [
      ...new Set(config.rentalVariantIds.map((v) => v.trim()).filter((v) => v !== "")),
    ],
  };
}

export interface LoadedRentalConfig {
  /** The stored (or default) document, as saved. */
  config: RentalConfig;
  /** "saved" = merchant doc; "default" = code defaults (no doc, or doc failed validation). */
  source: "saved" | "default";
  /** What consumers honour (identical shape in v1 — kept as a
   *  separate field so the config API mirrors the services one). */
  effective: EffectiveRentalConfig;
}

function toLoaded(config: RentalConfig, source: "saved" | "default"): LoadedRentalConfig {
  const cleaned = clean(config);
  return { config: cleaned, source, effective: { ...cleaned } };
}

/** The stored config with defaults fallback — never throws. */
export async function loadRentalConfig(): Promise<LoadedRentalConfig> {
  let raw: string | null = null;
  try {
    raw = await getSetting(RENTAL_CONFIG_KEY);
  } catch {
    raw = null;
  }
  if (raw) {
    try {
      const parsed = rentalConfigSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return toLoaded(parsed.data, "saved");
    } catch {
      // Corrupt JSON — fall through to defaults (documented above).
    }
  }
  return toLoaded(DEFAULT_RENTAL_CONFIG, "default");
}

/** Persist a validated config (the admin route validates first).
 *  Throws on DB failure — the route reports 503 rather than
 *  claiming a save that did not happen. */
export async function saveRentalConfig(config: RentalConfig, actorId: string): Promise<void> {
  const value = JSON.stringify(clean(config));
  await prisma.setting.upsert({
    where: { key: RENTAL_CONFIG_KEY },
    create: {
      key: RENTAL_CONFIG_KEY,
      value,
      valueEncrypted: false,
      isPublic: false,
      category: "general",
      description: "Rental module config document (JSON, ADV-23)",
      updatedById: actorId,
    },
    update: { value, valueEncrypted: false, updatedById: actorId },
  });
  invalidateSettingCache(RENTAL_CONFIG_KEY);
}
