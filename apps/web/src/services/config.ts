/**
 * Services config — ADV-23 vertical 2 (doc 23, wave 56).
 *
 * Storage: ONE Setting document, key `services.config`, holding
 *   { slotMinutes, openTime, closeTime, closedWeekdays, advanceDays,
 *     bufferMinutes, capacityPerSlot, serviceVariantIds }
 * written with the established doc-store mechanism (direct
 * prisma.setting.upsert + invalidateSettingCache — the generic
 * setSetting() path rejects keys outside SETTING_DEFAULTS, the same
 * reason restaurant.config / templates.* docs have their own
 * stores).
 *
 * FAIL-SOFT READS (the config-store.ts contract): a missing doc, a
 * corrupt doc, or a DB error resolves to the code defaults —
 *   30-minute slots, 09:00–21:00, no closed weekdays, 14 days ahead,
 *   no buffer, capacity 1 per slot, and an EMPTY serviceVariantIds
 *   list (nothing is bookable until the merchant lists variants —
 *   the fail-soft default can never invent a service).
 */
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { getSetting, invalidateSettingCache } from "@/lib/settings";
import type { EffectiveServicesConfig } from "./selection";

export const SERVICES_CONFIG_KEY = "services.config";

const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be HH:MM");

/** The plain object schema (no refinements) — the admin config
 *  route extends THIS with its `reason` field (a ZodEffects cannot
 *  be extended), then validates the whole against
 *  servicesConfigSchema below. */
export const servicesConfigObjectSchema = z.object({
  slotMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).default(30),
  openTime: hhmm.default("09:00"),
  closeTime: hhmm.default("21:00"),
  /** Weekdays the service is closed (0 = Sunday … 6 = Saturday). */
  closedWeekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  /** How far ahead (days from today, Dhaka) bookings open. */
  advanceDays: z.number().int().min(0).max(60).default(14),
  /** Turnaround minutes blocked after each booking. */
  bufferMinutes: z.number().int().min(0).max(120).default(0),
  /** Max simultaneous BOOKED bookings per (variant, slot). */
  capacityPerSlot: z.number().int().min(1).max(20).default(1),
  /** The v1 "what is a service" marker — see selection.ts. */
  serviceVariantIds: z.array(z.string().trim().min(1)).max(200).default([]),
});

export const servicesConfigSchema = servicesConfigObjectSchema.refine(
  (c) => c.openTime < c.closeTime,
  { message: "openTime must be before closeTime", path: ["closeTime"] },
);

export type ServicesConfig = z.infer<typeof servicesConfigObjectSchema>;

export const DEFAULT_SERVICES_CONFIG: ServicesConfig = {
  slotMinutes: 30,
  openTime: "09:00",
  closeTime: "21:00",
  closedWeekdays: [],
  advanceDays: 14,
  bufferMinutes: 0,
  capacityPerSlot: 1,
  serviceVariantIds: [],
};

/** De-duplicate + sort the closed weekdays and de-duplicate the
 *  variant list (first occurrence wins), applied at save AND at
 *  read so a hand-edited doc cannot smuggle duplicates in either. */
function clean(config: ServicesConfig): ServicesConfig {
  return {
    ...config,
    closedWeekdays: [...new Set(config.closedWeekdays)].sort((a, b) => a - b),
    serviceVariantIds: [...new Set(config.serviceVariantIds.map((v) => v.trim()).filter((v) => v !== ""))],
  };
}

export interface LoadedServicesConfig {
  /** The stored (or default) document, as saved. */
  config: ServicesConfig;
  /** "saved" = merchant doc; "default" = code defaults (no doc, or doc failed validation). */
  source: "saved" | "default";
  /** What consumers honour (identical shape in v1 — kept as a
   *  separate field so the config API mirrors the restaurant one). */
  effective: EffectiveServicesConfig;
}

function toLoaded(config: ServicesConfig, source: "saved" | "default"): LoadedServicesConfig {
  const cleaned = clean(config);
  return { config: cleaned, source, effective: { ...cleaned } };
}

/** The stored config with defaults fallback — never throws. */
export async function loadServicesConfig(): Promise<LoadedServicesConfig> {
  let raw: string | null = null;
  try {
    raw = await getSetting(SERVICES_CONFIG_KEY);
  } catch {
    raw = null;
  }
  if (raw) {
    try {
      const parsed = servicesConfigSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return toLoaded(parsed.data, "saved");
    } catch {
      // Corrupt JSON — fall through to defaults (documented above).
    }
  }
  return toLoaded(DEFAULT_SERVICES_CONFIG, "default");
}

/** Persist a validated config (the admin route validates first).
 *  Throws on DB failure — the route reports 503 rather than
 *  claiming a save that did not happen. */
export async function saveServicesConfig(config: ServicesConfig, actorId: string): Promise<void> {
  const value = JSON.stringify(clean(config));
  await prisma.setting.upsert({
    where: { key: SERVICES_CONFIG_KEY },
    create: {
      key: SERVICES_CONFIG_KEY,
      value,
      valueEncrypted: false,
      isPublic: false,
      category: "general",
      description: "Services module config document (JSON, ADV-23)",
      updatedById: actorId,
    },
    update: { value, valueEncrypted: false, updatedById: actorId },
  });
  invalidateSettingCache(SERVICES_CONFIG_KEY);
}
