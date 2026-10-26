/**
 * Subscription-boxes config — ADV-23 vertical 4 (doc 23, wave 56).
 *
 * Storage: ONE Setting document, key `boxes.config`, holding
 *   { boxVariantIds, cycles, discountBps }
 * written with the established doc-store mechanism (direct
 * prisma.setting.upsert + invalidateSettingCache — the generic
 * setSetting() path rejects keys outside SETTING_DEFAULTS, the same
 * reason services.config / restaurant.config have their own
 * stores).
 *
 * THE BOX MARKER: the Subscription model has no kind/type field
 * (wave 51 built it for per-product auto-replenish), so — exactly
 * like services' serviceVariantIds — a variant IS a subscription
 * box while its id is on `boxVariantIds`. One list, read everywhere
 * (PDP, account page, admin, generator), no schema change.
 *
 * DISCOUNT: `discountBps` is basis points of the box price, the
 * platform's discount unit everywhere (the wave-51 engine reads
 * Settings subscriptions.discount_bps the same way). For a box
 * order a POSITIVE box discount replaces the global subscription
 * discount; 0 falls back to the global one — see generate.ts. The
 * PDP shows the same effective figure the generator will use.
 *
 * FAIL-SOFT READS (the config-store contract): a missing doc, a
 * corrupt doc, or a DB error resolves to the code defaults — an
 * EMPTY boxVariantIds list (nothing is a box until the merchant
 * lists variants; the fail-soft default can never invent a box),
 * monthly cycles only, no box discount.
 */
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { getSetting, invalidateSettingCache } from "@/lib/settings";
import { BOX_CYCLES } from "./cycles";

export const BOXES_CONFIG_KEY = "boxes.config";

/** The plain object schema (no refinements) — the admin config
 *  route extends THIS with its `reason` field. */
export const boxesConfigObjectSchema = z.object({
  /** Variants that are subscription boxes (the v1 box marker). */
  boxVariantIds: z.array(z.string().trim().min(1)).max(200).default([]),
  /** Cycle kinds a box may be subscribed on. At least one — the PDP
   *  offers exactly these, mapped via CYCLE_INTERVALS. */
  cycles: z.array(z.enum(BOX_CYCLES)).min(1).default(["monthly"]),
  /** Subscriber discount on the box price, basis points
   *  (0..5000 — the same 50% sanity clamp as the wave-51 discount). */
  discountBps: z.number().int().min(0).max(5000).default(0),
});

export const boxesConfigSchema = boxesConfigObjectSchema;

export type BoxesConfig = z.infer<typeof boxesConfigObjectSchema>;

export const DEFAULT_BOXES_CONFIG: BoxesConfig = {
  boxVariantIds: [],
  cycles: ["monthly"],
  discountBps: 0,
};

/** De-duplicate the variant list and the cycle list (first
 *  occurrence wins), applied at save AND at read so a hand-edited
 *  doc cannot smuggle duplicates in either. */
function clean(config: BoxesConfig): BoxesConfig {
  return {
    boxVariantIds: [...new Set(config.boxVariantIds.map((v) => v.trim()).filter((v) => v !== ""))],
    cycles: [...new Set(config.cycles)],
    discountBps: config.discountBps,
  };
}

export interface LoadedBoxesConfig {
  /** The stored (or default) document, as saved. */
  config: BoxesConfig;
  /** "saved" = merchant doc; "default" = code defaults (no doc, or doc failed validation). */
  source: "saved" | "default";
  /** What consumers honour (identical shape in v1 — kept as a
   *  separate field so the config API mirrors the sibling ones). */
  effective: BoxesConfig;
}

function toLoaded(config: BoxesConfig, source: "saved" | "default"): LoadedBoxesConfig {
  const cleaned = clean(config);
  return { config: cleaned, source, effective: { ...cleaned } };
}

/** The stored config with defaults fallback — never throws. */
export async function loadBoxesConfig(): Promise<LoadedBoxesConfig> {
  let raw: string | null = null;
  try {
    raw = await getSetting(BOXES_CONFIG_KEY);
  } catch {
    raw = null;
  }
  if (raw) {
    try {
      const parsed = boxesConfigSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return toLoaded(parsed.data, "saved");
    } catch {
      // Corrupt JSON — fall through to defaults (documented above).
    }
  }
  return toLoaded(DEFAULT_BOXES_CONFIG, "default");
}

/** Persist a validated config (the admin route validates first).
 *  Throws on DB failure — the route reports 503 rather than
 *  claiming a save that did not happen. */
export async function saveBoxesConfig(config: BoxesConfig, actorId: string): Promise<void> {
  const value = JSON.stringify(clean(config));
  await prisma.setting.upsert({
    where: { key: BOXES_CONFIG_KEY },
    create: {
      key: BOXES_CONFIG_KEY,
      value,
      valueEncrypted: false,
      isPublic: false,
      category: "general",
      description: "Subscription boxes config document (JSON, ADV-23)",
      updatedById: actorId,
    },
    update: { value, valueEncrypted: false, updatedById: actorId },
  });
  invalidateSettingCache(BOXES_CONFIG_KEY);
}

export function isBoxVariantId(config: BoxesConfig, variantId: string): boolean {
  return config.boxVariantIds.includes(variantId);
}

/** The discount a box order actually gets: a positive box discount
 *  replaces the global Subscribe & Save discount; 0 falls back to
 *  it. One rule, used by BOTH the generator and the PDP, so the
 *  price a customer is shown is the price the order carries. */
export function effectiveBoxDiscountBps(config: BoxesConfig, globalDiscountBps: number): number {
  return config.discountBps > 0 ? config.discountBps : globalDiscountBps;
}
