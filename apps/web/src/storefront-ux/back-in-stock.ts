/**
 * Back-in-stock notify signup — Part B. Pure validation logic + the
 * in-memory demo store (kept for tests/preview). The DB-backed store
 * the public signup route uses lives in back-in-stock-db.ts — it is
 * server-only (Prisma) and must never be imported from this module,
 * which client components import.
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
import { pick, type Locale } from "@/i18n/locale";
import type { BackInStockSignup, BackInStockSignupPublic } from "./types";

/** Doc 30: store-level validation errors, locale-keyed. The public API
 *  route surfaces these verbatim; it passes the request locale when it
 *  has one (default bn = legacy behaviour). */
export const BACK_IN_STOCK_ERRORS: Record<Locale, { invalidInfo: string; invalidPhone: string }> = {
  bn: { invalidInfo: "সঠিক তথ্য দিন।", invalidPhone: "সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)।" },
  en: { invalidInfo: "Please provide valid information.", invalidPhone: "Please enter a valid mobile number (01XXXXXXXXX)." },
};

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

  add(input: BackInStockSignupInput, now: Date = new Date(), locale: Locale = "bn"): SignupResult {
    const errors = pick(locale, BACK_IN_STOCK_ERRORS);
    const parsed = backInStockSignupSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: errors.invalidInfo };
    const phone = normalizeBdPhone(parsed.data.phone);
    if (!phone) return { ok: false, error: errors.invalidPhone };
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

/** Shared with the DB store (back-in-stock-db.ts) so both stores mask
 *  phones identically in every outward view. */
export const backInStockToPublic = toPublic;

/** Shared demo store — in-memory only; the public route uses the
 *  Prisma store in back-in-stock-db.ts. Kept for tests and isolated
 *  previews. */
export const demoBackInStockStore = new InMemoryBackInStockStore();
