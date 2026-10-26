/**
 * Grocery pack — Agent 17, Step 49 (Part C).
 * Weight-based pricing (price per kg, sold by gram) and delivery-slot
 * types. Weight math is integer grams × integer poisha-per-kg with a
 * single floor at the end — no float money at any step.
 */
import { z } from "zod";
import type { BusinessModulePack, PackValidation } from "./types";

export const deliverySlotSchema = z.object({
  id: z.string().min(1),
  labelBn: z.string().min(1),
  labelEn: z.string().min(1),
  /** "HH:MM" 24h local (Asia/Dhaka) start/end. */
  startsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  /** Orders per slot cap; the checkout must refuse beyond this. */
  capacity: z.number().int().positive(),
  /** Order must be placed this many minutes before the slot starts. */
  cutoffMinutes: z.number().int().min(0).default(60),
});

export type DeliverySlot = z.infer<typeof deliverySlotSchema>;

export const groceryConfigSchema = z.object({
  /** Smallest sellable weight step, grams. */
  weightStepGrams: z.number().int().positive().default(250),
  maxWeightGramsPerItem: z.number().int().positive().default(25_000),
  slots: z.array(deliverySlotSchema).max(12).default([]),
  /**
   * ADV-22 wiring: category slugs this pack's weighted pricing applies
   * to (display annotation scope). Matching rule lives in packs.ts
   * (packCategoryMatches): exact slug, or a slug ending in "-<entry>"
   * (so the seeded demo-grocery category resolves to this pack).
   */
  categorySlugs: z.array(z.string().min(1)).max(20).default(["grocery"]),
  /**
   * ADV-22 weighted (per-kg) pricing — the honest fixed-pack model.
   *
   * TRUE fractional quantities cannot flow through the order seam:
   * OrderItem.quantity, CartItem.quantity, the checkout zod schema and
   * the stock ledger are ALL integer units (audited 2026-10-26), and a
   * schema change is out of this slice's ownership. So a weighted
   * product is sold as FIXED WEIGHT PACKS: each entry names one variant
   * (one pack), its per-kg rate and the pack's weight in grams. The
   * pack's price is DERIVED — priceForWeight(rate, packGrams) — and an
   * admin sync action (POST /api/v1/admin/grocery/weighted-prices/sync)
   * writes the derived price onto the variant's recorded pricePoisha,
   * which is what checkout actually charges (checkout always re-reads
   * the recorded price server-side). PDP/cart annotate rate + pack
   * weight; the derived pack price is only DISPLAYED when it equals
   * the recorded price, so a stale (unsynced) price is never presented
   * as the rate-derived one.
   */
  weightedVariants: z
    .array(
      z.object({
        variantId: z.string().min(1),
        pricePerKgPoisha: z.number().int().positive(),
        packGrams: z.number().int().positive(),
      }),
    )
    .max(500)
    .default([]),
});

export type GroceryConfig = z.infer<typeof groceryConfigSchema>;

export const groceryPack: BusinessModulePack<GroceryConfig> = {
  id: "grocery",
  flagKey: "module.grocery",
  nameEn: "Grocery",
  nameBn: "মুদি / গ্রোসারি",
  description: "Weight-based pricing and scheduled delivery slots for grocery stores.",
  defaultConfig: {
    weightStepGrams: 250,
    maxWeightGramsPerItem: 25_000,
    categorySlugs: ["grocery"],
    weightedVariants: [],
    slots: [
      { id: "morning", labelBn: "সকাল", labelEn: "Morning", startsAt: "08:00", endsAt: "12:00", capacity: 40, cutoffMinutes: 60 },
      { id: "afternoon", labelBn: "বিকাল", labelEn: "Afternoon", startsAt: "12:00", endsAt: "17:00", capacity: 40, cutoffMinutes: 60 },
      { id: "evening", labelBn: "সন্ধ্যা", labelEn: "Evening", startsAt: "17:00", endsAt: "21:00", capacity: 40, cutoffMinutes: 60 },
    ],
  },
  configSchema: groceryConfigSchema,
};

/** Price for a weight: floor(pricePerKgPoisha × grams / 1000). Integer in, integer out. */
export function priceForWeight(pricePerKgPoisha: number, grams: number): number {
  if (!Number.isInteger(pricePerKgPoisha) || !Number.isInteger(grams) || grams < 0) {
    throw new Error("Weight pricing needs integer poisha-per-kg and integer grams.");
  }
  return Math.floor((pricePerKgPoisha * grams) / 1000);
}

/** The weighted-pack config entry for one variant, or null. */
export function weightedVariantFor(
  config: GroceryConfig,
  variantId: string,
): { variantId: string; pricePerKgPoisha: number; packGrams: number } | null {
  return config.weightedVariants.find((w) => w.variantId === variantId) ?? null;
}

export function validateGrocerySelection(
  config: GroceryConfig,
  input: { grams: number; slotId?: string; slotBookedCount?: number; minutesUntilSlotStart?: number },
): PackValidation {
  const errors: Array<{ field: string; message: string }> = [];
  if (!Number.isInteger(input.grams) || input.grams <= 0) {
    errors.push({ field: "grams", message: "Weight must be a positive whole number of grams." });
  } else {
    if (input.grams % config.weightStepGrams !== 0) {
      errors.push({ field: "grams", message: `Weight must be in steps of ${config.weightStepGrams}g.` });
    }
    if (input.grams > config.maxWeightGramsPerItem) {
      errors.push({ field: "grams", message: "Weight exceeds the per-item maximum." });
    }
  }
  if (input.slotId !== undefined) {
    const slot = config.slots.find((s) => s.id === input.slotId);
    if (!slot) {
      errors.push({ field: "slotId", message: "Delivery slot does not exist." });
    } else {
      if (input.slotBookedCount !== undefined && input.slotBookedCount >= slot.capacity) {
        errors.push({ field: "slotId", message: "Delivery slot is full." });
      }
      if (input.minutesUntilSlotStart !== undefined && input.minutesUntilSlotStart < slot.cutoffMinutes) {
        errors.push({ field: "slotId", message: "Delivery slot cutoff has passed." });
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}
