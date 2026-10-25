// One-page checkout validation — Zod, TypeScript strict.
// Mirrors packages/validators/src/phone.ts (BD_PHONE_REGEX) so this module is
// self-contained; the validators package remains the canonical source.
import { z } from "zod";

export const BD_PHONE_REGEX = /^(?:\+?88)?01[3-9]\d{8}$/;

/** Normalize any accepted BD form to +8801XXXXXXXXX. Returns null if invalid. */
export function normalizeBdPhone(input: string): string | null {
  const cleaned = input.replace(/[\s-]/g, "");
  if (!BD_PHONE_REGEX.test(cleaned)) return null;
  const digits = cleaned.replace(/^\+?88/, "");
  return `+880${digits.slice(-10)}`;
}

export function maskPhone(normalized: string): string {
  if (normalized.length < 5) return normalized;
  return `${normalized.slice(0, 5)}******${normalized.slice(-2)}`;
}

// Address values are canonicalised by construction, not by hard
// schema membership (doc 17 O2): the storefront checkout picks
// division/district/upazila from the geo cascade (GET
// /api/v1/public/geo), so what arrives here is already the canonical
// dataset nameEn. This schema is SHARED with staff manual orders,
// where free text + parser suggestions are the flow — a hard
// dataset-membership reject would break legitimate staff entries
// (Bangla spellings, newly created upazilas), so the fields stay
// strings. Fields are trimmed so " Dhaka " can never split one
// district into two spellings downstream; the shipping engine
// derives the delivery zone from the district server-side and never
// trusts a client-picked zone.
export const bdAddressSchema = z.object({
  division: z.string().trim().min(1, "Division dite hobe"),
  district: z.string().trim().min(1, "District dite hobe"),
  upazila: z.string().trim().min(1, "Upazila dite hobe"),
  /** Union optional per the platform spec. */
  union: z.string().trim().optional(),
  addressLine: z.string().trim().min(5, "Purno thikana (basa/holding/area) dite hobe"),
});

export type BdAddress = z.infer<typeof bdAddressSchema>;

export const checkoutItemSchema = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().positive("Quantity 1 er kom hote parbe na"),
});

export const checkoutFormSchema = z.object({
  customerName: z.string().min(2, "Nam dite hobe"),
  /** Phone required; email optional (phone-first checkout). */
  phone: z
    .string()
    .refine((v) => BD_PHONE_REGEX.test(v.replace(/[\s-]/g, "")), {
      message: "Sothik Bangladesh mobile number din (01XXXXXXXXX)",
    })
    .transform((v) => normalizeBdPhone(v) as string),
  email: z.string().email("Sothik email din").optional().or(z.literal("")),
  address: bdAddressSchema,
  note: z.string().max(500).optional(),
  shippingMethod: z.enum(["inside_dhaka", "outside_dhaka", "pickup"]),
  paymentMethod: z.enum(["cod", "bkash", "nagad", "sslcommerz", "aamarpay", "shurjopay"]),
  items: z.array(checkoutItemSchema).min(1, "Cart khali — age product add korun"),
  /** Idempotency key: a UUID v4 generated once per checkout attempt. */
  idempotencyKey: z.string().uuid("Idempotency key UUID hote hobe"),
  couponCode: z.string().optional(),
  /**
   * Optional reseller attribution code (wave 6): captured client-side
   * from a ?ref=CODE link into localStorage. Deliberately permissive
   * here — the server normalizes it and resolves it against ACTIVE
   * resellers only (src/reseller/store.resolveResellerAttribution);
   * an unknown or ineligible code never fails the order, it simply
   * attributes nothing.
   */
  resellerCode: z.string().max(32).optional(),
  /**
   * Optional abandoned-checkout session key (wave 22, doc 17 batch
   * O4): the checkout page's sessionStorage UUID for its capture row.
   * When present, the orders route stamps that capture RECOVERED
   * post-commit (guarded — absence simply skips the marking).
   */
  checkoutSessionKey: z.string().uuid().optional(),
});

export type CheckoutForm = z.infer<typeof checkoutFormSchema>;

export function validateCheckoutForm(
  input: unknown,
): { ok: true; data: CheckoutForm } | { ok: false; errors: string[] } {
  const parsed = checkoutFormSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}
