/**
 * Back-in-stock notify signup — Part B. Pure logic + in-memory demo store.
 *
 * A customer leaves a BD phone for an out-of-stock variant; when stock is
 * restored (stock_movements restore/commit path) the notify job sends ONE
 * SMS via the admin-configured SmsProvider. This module only validates and
 * stores the signup — it never sends anything.
 *
 * Phone is stored normalized (+8801XXXXXXXXX); every outward view masks it.
 * Duplicate signup for the same product+variant+phone is a no-op success
 * (the customer does not need to know, and must not get two SMS).
 */
import { z } from "zod";
import { maskPhone, normalizeBdPhone } from "@advance-ecommerce/validators";
import type { BackInStockSignup, BackInStockSignupPublic } from "./types";

export const backInStockSignupSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).nullable().default(null),
  /** Any BD format the customer types; normalized before storage. */
  phone: z.string().min(11).max(15),
});

export type BackInStockSignupInput = z.infer<typeof backInStockSignupSchema>;

export type SignupResult =
  | { ok: true; signup: BackInStockSignupPublic; duplicate: boolean }
  | { ok: false; error: string };

export class InMemoryBackInStockStore {
  private readonly signups: BackInStockSignup[] = [];

  add(input: BackInStockSignupInput, now: Date = new Date()): SignupResult {
    const parsed = backInStockSignupSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "সঠিক তথ্য দিন।" };
    const phone = normalizeBdPhone(parsed.data.phone);
    if (!phone) return { ok: false, error: "সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)।" };
    const existing = this.signups.find(
      (s) => s.productId === parsed.data.productId && s.variantId === parsed.data.variantId && s.phone === phone,
    );
    if (existing) return { ok: true, signup: toPublic(existing), duplicate: true };
    const signup: BackInStockSignup = {
      productId: parsed.data.productId,
      variantId: parsed.data.variantId,
      phone,
      createdAt: now.toISOString(),
    };
    this.signups.push(signup);
    return { ok: true, signup: toPublic(signup), duplicate: false };
  }

  listForProduct(productId: string): BackInStockSignupPublic[] {
    return this.signups.filter((s) => s.productId === productId).map(toPublic);
  }

  /** Raw rows for the (future) notify job — server-side only. */
  pendingForVariant(productId: string, variantId: string | null): BackInStockSignup[] {
    return this.signups.filter((s) => s.productId === productId && s.variantId === variantId);
  }
}

function toPublic(s: BackInStockSignup): BackInStockSignupPublic {
  return { productId: s.productId, variantId: s.variantId, maskedPhone: maskPhone(s.phone), createdAt: s.createdAt };
}

/** Shared demo store — TEMPORARY, replaced by a back_in_stock_signups table. */
export const demoBackInStockStore = new InMemoryBackInStockStore();
