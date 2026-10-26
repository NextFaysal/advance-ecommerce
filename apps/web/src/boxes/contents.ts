/**
 * Subscription-box cycle contents — ADV-23 vertical 4 (wave 56).
 *
 * Storage: ONE Setting document PER BOX VARIANT, key
 * `boxes.contents.<variantId>`, holding
 *   { variantId, cycles: [{ cycleKey, noteBn?, noteEn?, items }] }
 * via the same doc-store mechanism as boxes.config (see config.ts).
 *
 * Item names/SKUs are SNAPSHOTTED into the doc at save time (the
 * admin contents route resolves every item variant against the real
 * catalog before saving). That makes the doc a durable record on
 * its own: the generated order's note, the account page's "what was
 * in the last box" and the admin generations list all read names
 * from here — a content variant renamed or deleted later never
 * rewrites what a past cycle contained.
 *
 * FAIL-SOFT READS: a missing/corrupt doc resolves to null ("no
 * contents defined"). For the GENERATOR, null is a hard stop for
 * that cycle — never a licence to ship an empty box or reuse the
 * previous cycle (see generate.ts).
 */
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { getSetting, invalidateSettingCache } from "@/lib/settings";
import { isValidQtyNumber } from "@/lib/quantity";
import { isValidCycleKey } from "./cycles";

export function boxContentsKey(variantId: string): string {
  return `boxes.contents.${variantId}`;
}

export interface BoxContentItem {
  variantId: string;
  /** Per ONE box. May be fractional on a weighted variant (wave 59). */
  quantity: number;
  productName: string;
  sku: string;
  variantLabel: string;
}

export interface BoxCycleContents {
  cycleKey: string;
  noteBn?: string;
  noteEn?: string;
  items: BoxContentItem[];
}

export interface BoxContentsDoc {
  variantId: string;
  cycles: BoxCycleContents[];
}

const contentItemSchema = z.object({
  variantId: z.string().trim().min(1),
  quantity: z
    .number()
    .refine((v) => isValidQtyNumber(v) && v <= 999, "Quantity must be positive (max 999, up to 3 decimals)"),
  productName: z.string().trim().min(1).max(200),
  sku: z.string().trim().min(1).max(100),
  variantLabel: z.string().trim().max(200),
});

const cycleContentsSchema = z.object({
  cycleKey: z.string().refine(isValidCycleKey, "cycleKey must be YYYY-MM or YYYY-Www"),
  noteBn: z.string().trim().max(300).optional(),
  noteEn: z.string().trim().max(300).optional(),
  items: z.array(contentItemSchema).max(50),
});

export const boxContentsDocSchema = z.object({
  variantId: z.string().trim().min(1),
  cycles: z.array(cycleContentsSchema).max(60),
});

/** The stored contents doc for one box variant — null when no doc
 *  exists or the stored doc fails validation. Never throws. */
export async function loadBoxContents(variantId: string): Promise<BoxContentsDoc | null> {
  let raw: string | null = null;
  try {
    raw = await getSetting(boxContentsKey(variantId));
  } catch {
    raw = null;
  }
  if (!raw) return null;
  try {
    const parsed = boxContentsDocSchema.safeParse(JSON.parse(raw));
    if (parsed.success && parsed.data.variantId === variantId) return parsed.data;
  } catch {
    // Corrupt JSON — treated as "no contents defined".
  }
  return null;
}

/** Persist a validated contents doc (the admin route validates +
 *  snapshots item names first). Throws on DB failure. */
export async function saveBoxContents(doc: BoxContentsDoc, actorId: string): Promise<void> {
  const key = boxContentsKey(doc.variantId);
  const value = JSON.stringify(doc);
  await prisma.setting.upsert({
    where: { key },
    create: {
      key,
      value,
      valueEncrypted: false,
      isPublic: false,
      category: "general",
      description: `Subscription box cycle contents for variant ${doc.variantId} (JSON, ADV-23)`,
      updatedById: actorId,
    },
    update: { value, valueEncrypted: false, updatedById: actorId },
  });
  invalidateSettingCache(key);
}

/** The contents defined for one cycle — null when the cycle is not
 *  in the doc (the generator's skip condition). */
export function findCycleContents(
  doc: BoxContentsDoc | null,
  cycleKey: string,
): BoxCycleContents | null {
  if (doc === null) return null;
  return doc.cycles.find((c) => c.cycleKey === cycleKey) ?? null;
}
