/**
 * Print-on-demand config — ADV-23 vertical 5 (doc 23, wave 56).
 *
 * Storage: ONE Setting document, key `pod.config`, holding
 *   { podVariantIds, printFeePoisha, textMaxChars,
 *     allowImageUpload, colors }
 * written with the established doc-store mechanism (direct
 * prisma.setting.upsert + invalidateSettingCache — the generic
 * setSetting() path rejects keys outside SETTING_DEFAULTS, the
 * same reason rental.config / services.config docs have their own
 * stores).
 *
 * FAIL-SOFT READS (the config-store.ts contract): a missing doc, a
 * corrupt doc, or a DB error resolves to the code defaults —
 *   NO printable variants (the fail-soft default can never invent
 *   a customisable product), print fee 0 (a corrupt doc can never
 *   invent a charge), text cap 20, image upload NOT allowed, no
 *   colour palette.
 *
 * `allowImageUpload` is stored intent ONLY in v1: customer artwork
 * upload needs object storage (Settings storage.* — R2/S3
 * credentials the merchant has not added yet), so no upload
 * endpoint exists and no surface offers one, whatever this flag
 * says. It is exposed on the config APIs so the merchant's choice
 * is on record for the day storage lands.
 */
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { getSetting, invalidateSettingCache } from "@/lib/settings";
import type { EffectivePodConfig } from "./selection";

export const POD_CONFIG_KEY = "pod.config";

/** The plain object schema (no refinements) — the admin config
 *  route extends THIS with its `reason` field. */
export const podConfigObjectSchema = z.object({
  /** The v1 "what is custom-printable" marker — see selection.ts. */
  podVariantIds: z.array(z.string().trim().min(1)).max(200).default([]),
  /** Print fee PER ITEM (poisha), charged once per unit of the
   *  POD line; 0 = printing included in the item price. */
  printFeePoisha: z.number().int().min(0).max(100_000_000).default(0),
  /** Max print-text length, in Unicode code points. */
  textMaxChars: z.number().int().min(1).max(200).default(20),
  /** Stored intent only in v1 — see the header. */
  allowImageUpload: z.boolean().default(false),
  /** The print-colour palette, verbatim labels (e.g. "লাল",
   *  "#C0392B"). A colour outside this list is refused at the
   *  gate; an empty palette accepts no colour choice at all. */
  colors: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
});

export const podConfigSchema = podConfigObjectSchema;

export type PodConfig = z.infer<typeof podConfigObjectSchema>;

export const DEFAULT_POD_CONFIG: PodConfig = {
  podVariantIds: [],
  printFeePoisha: 0,
  textMaxChars: 20,
  allowImageUpload: false,
  colors: [],
};

/** De-duplicate the variant list + palette (first occurrence
 *  wins), applied at save AND at read so a hand-edited doc cannot
 *  smuggle duplicates in either. */
function clean(config: PodConfig): PodConfig {
  return {
    ...config,
    podVariantIds: [
      ...new Set(config.podVariantIds.map((v) => v.trim()).filter((v) => v !== "")),
    ],
    colors: [...new Set(config.colors.map((c) => c.trim()).filter((c) => c !== ""))],
  };
}

export interface LoadedPodConfig {
  /** The stored (or default) document, as saved. */
  config: PodConfig;
  /** "saved" = merchant doc; "default" = code defaults (no doc, or doc failed validation). */
  source: "saved" | "default";
  /** What consumers honour (identical shape in v1 — kept as a
   *  separate field so the config API mirrors the rental one). */
  effective: EffectivePodConfig;
}

function toLoaded(config: PodConfig, source: "saved" | "default"): LoadedPodConfig {
  const cleaned = clean(config);
  return { config: cleaned, source, effective: { ...cleaned } };
}

/** The stored config with defaults fallback — never throws. */
export async function loadPodConfig(): Promise<LoadedPodConfig> {
  let raw: string | null = null;
  try {
    raw = await getSetting(POD_CONFIG_KEY);
  } catch {
    raw = null;
  }
  if (raw) {
    try {
      const parsed = podConfigSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return toLoaded(parsed.data, "saved");
    } catch {
      // Corrupt JSON — fall through to defaults (documented above).
    }
  }
  return toLoaded(DEFAULT_POD_CONFIG, "default");
}

/** Persist a validated config (the admin route validates first).
 *  Throws on DB failure — the route reports 503 rather than
 *  claiming a save that did not happen. */
export async function savePodConfig(config: PodConfig, actorId: string): Promise<void> {
  const value = JSON.stringify(clean(config));
  await prisma.setting.upsert({
    where: { key: POD_CONFIG_KEY },
    create: {
      key: POD_CONFIG_KEY,
      value,
      valueEncrypted: false,
      isPublic: false,
      category: "general",
      description: "Print-on-demand module config document (JSON, ADV-23)",
      updatedById: actorId,
    },
    update: { value, valueEncrypted: false, updatedById: actorId },
  });
  invalidateSettingCache(POD_CONFIG_KEY);
}
