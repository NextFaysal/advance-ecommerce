// One-page checkout validation — Zod, TypeScript strict.
// Mirrors packages/validators/src/phone.ts (BD_PHONE_REGEX) so this module is
// self-contained; the validators package remains the canonical source.
import { z } from "zod";
import { isValidQtyNumber } from "../lib/quantity";
// ADV-23 (wave 56): the restaurant selection shape lives in its own
// pure module so the manual-create seam validates the identical
// shape — one definition, two create paths.
import { restaurantSelectionSchema } from "../restaurant/selection";
// ADV-23 vertical 2 (wave 56): same arrangement for the service
// booking selection — one definition in src/services/selection.ts,
// shared by checkout and the manual-create seam.
import { serviceBookingSelectionSchema } from "../services/selection";
// ADV-23 vertical 3 (wave 56): same arrangement for the rental
// selection — one definition in src/rental/selection.ts, shared by
// checkout and the manual-create seam.
import { rentalSelectionSchema } from "../rental/selection";
// ADV-23 vertical 5 (wave 56): same arrangement for the
// print-on-demand customisation — one definition in
// src/pod/selection.ts, shared by checkout and the manual-create
// seam.
import { podSelectionSchema } from "../pod/selection";

// The pure BD phone helpers live in ./phone (schema-free, so client
// components can import maskPhone without bundling zod); they are
// re-exported here so every existing import from this module keeps
// working unchanged.
import { BD_PHONE_REGEX, normalizeBdPhone } from "./phone";
export { BD_PHONE_REGEX, maskPhone, normalizeBdPhone } from "./phone";

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
  // Wave 59: quantities may be fractional (<= 3 decimals) — but ONLY
  // for grocery weighted variants; the integer/weighted gate itself
  // is enforced server-side in the create path
  // (src/orders/quantity-rules.ts), which knows the pack config.
  quantity: z
    .number()
    .refine((v) => isValidQtyNumber(v), "Quantity sothik hote hobe (dhonattok, sorbochcho 3 doshomik)"),
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
  paymentMethod: z.enum(["cod", "bkash", "nagad", "rocket", "upay", "sslcommerz", "aamarpay", "shurjopay"]),
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
   * Optional gift-card code (ADV-18): a bearer code submitted at
   * checkout. Same permissive contract as resellerCode — the server
   * normalizes it (case/dash tolerant), validates it read-only for
   * pricing, and re-validates under a row lock inside the
   * order-create transaction. An unknown/ineligible code never fails
   * the order; it is reported in the response meta and the order
   * proceeds at full price. Only consulted when the
   * module.marketing_mechanics flag is on.
   */
  giftCardCode: z.string().max(64).optional(),
  /**
   * Optional abandoned-checkout session key (wave 22, doc 17 batch
   * O4): the checkout page's sessionStorage UUID for its capture row.
   * When present, the orders route stamps that capture RECOVERED
   * post-commit (guarded — absence simply skips the marking).
   */
  checkoutSessionKey: z.string().uuid().optional(),
  /**
   * Optional delivery slot id (doc 17 batch O9-2): one of the ids in
   * Settings orders.delivery_slots. Deliberately permissive here —
   * the orders route resolves it against the configured set and
   * persists only a match (an unknown/stale id is dropped, reported
   * in the response meta, and never fails the order).
   */
  deliverySlotId: z.string().max(64).optional(),
  /**
   * Optional pickup point id (ADV-19, click & collect): one of the ids
   * in Settings stores.pickup_points. Same contract as deliverySlotId
   * — the orders route resolves it against the configured set (only
   * when shippingMethod is "pickup") and records a match in the
   * create-time order note; an unknown/stale id is dropped, reported
   * in the response meta, and never fails the order.
   */
  pickupPointId: z.string().max(64).optional(),
  /**
   * Optional gift message (doc 17 batch O9-2): present (possibly an
   * empty string) only when the customer ticked the gift option.
   * Persisted verbatim on Order.giftMessage. No gift-wrap fee exists.
   */
  giftMessage: z.string().max(500).optional(),
  /**
   * Optional prescription RECORD (ADV-22, pharmacy pack): submitted
   * when the cart contains a prescription-required product (the
   * product carries the pack config's prescriptionTag). This is a
   * RECORD, not a verified prescription: the customer attests they
   * hold the prescription (attested must be literally true) and
   * records the prescriber's name + registration number; an image URL
   * is accepted when the customer already has one hosted (uploads are
   * storage-gated). The orders route re-derives the requirement from
   * DB product tags and refuses an Rx order without a valid record —
   * there is no bypass. The record rides the order's create-time note
   * and, when the pack requires it, the order enters the pharmacist
   * verification queue (src/business-modules/pharmacy-orders.ts).
   */
  prescription: z
    .object({
      prescriberName: z.string().trim().min(2).max(120),
      registrationNo: z.string().trim().min(2).max(64),
      imageUrl: z.string().url().max(500).optional(),
      attested: z.literal(true),
    })
    .optional(),
  /**
   * Optional age attestation (ADV-29, age gate): submitted when the
   * cart contains a product from an age-restricted category
   * (Settings catalog.age_restricted_categories). `confirmed` must be
   * literally true. This is a SELF-DECLARATION — the customer states
   * they meet the category's minimum age; no identity document or
   * birth date is collected or verified, and the orders route
   * re-derives the requirement from DB category slugs (never the
   * client) and refuses a restricted order without it
   * (400 AGE_ATTESTATION_REQUIRED). The attestation is recorded in
   * the order's create-time note (src/catalog/age-restrictions.ts).
   */
  ageAttestation: z
    .object({
      confirmed: z.literal(true),
    })
    .optional(),
  /**
   * Optional restaurant fulfilment selection (ADV-23, wave 56):
   * submitted when the restaurant module is on and the customer
   * picked dine-in (with a table) or takeaway at checkout. The
   * shape is src/restaurant/selection.ts (pure, shared with the
   * manual-create seam). The orders route re-validates the choice
   * against the merchant's effective restaurant.config — a stale
   * or forged table label is refused (400) there, and a payload
   * carrying this field while module.restaurant is OFF is refused
   * 403 FEATURE_LOCKED; without the field nothing changes.
   */
  restaurant: restaurantSelectionSchema.optional(),
  /**
   * Optional service booking selection (ADV-23 vertical 2,
   * wave 56): submitted when the services module is on and the
   * cart contains a variant from the merchant's bookable list
   * (services.config serviceVariantIds) — the customer picks a
   * date + slot on the checkout page from the availability API.
   * The shape is src/services/selection.ts (pure, shared with the
   * manual-create seam). The orders route re-validates the choice
   * against services.config (variant on the list, date window,
   * slot on the grid) and capacity is counted inside the create
   * transaction — a full slot refuses the order (409). A payload
   * carrying this field while module.services is OFF is refused
   * 403 FEATURE_LOCKED; without the field nothing changes. V1:
   * one booking per order, for a line of quantity exactly 1.
   */
  booking: serviceBookingSelectionSchema.optional(),
  /**
   * Optional rental selection (ADV-23 vertical 3, wave 56):
   * submitted when the rental module is on and the cart contains a
   * variant from the merchant's rental list (rental.config
   * rentalVariantIds) — the customer picks a start/end date range
   * on the checkout page, checked against the availability API.
   * The shape is src/rental/selection.ts (pure, shared with the
   * manual-create seam). The orders route re-validates the range
   * against rental.config (variant on the list, dates valid, start
   * not past, length within maxRentalDays) and counts overlapping
   * live rentals against the variant's stock inside the create
   * transaction — a fully booked window refuses the order (409).
   * When rental.config sets a deposit, the deposit joins the order
   * total as its own pricing line (rentalDepositPoisha). A payload
   * carrying this field while module.rental is OFF is refused 403
   * FEATURE_LOCKED; without the field nothing changes. V1: one
   * rental per order, for a line of quantity exactly 1.
   */
  rental: rentalSelectionSchema.optional(),
  /**
   * Optional print-on-demand customisation (ADV-23 vertical 5,
   * wave 56): submitted when the print-on-demand module is on and
   * the cart contains a variant from the merchant's printable list
   * (pod.config podVariantIds) — the customer types the print text
   * (and optionally picks a palette colour) on the checkout page.
   * The shape is src/pod/selection.ts (pure, shared with the
   * manual-create seam). The orders route re-validates it against
   * pod.config (variant listed, text sanitised + within the
   * config cap, colour on the palette) and freezes it onto the
   * order's create-time note; the configured per-item print fee
   * joins the order total as its own pricing line
   * (printFeePoisha). A payload carrying this field while
   * module.print_on_demand is OFF is refused 403 FEATURE_LOCKED;
   * without the field nothing changes. V1: one customised line
   * per order (its quantity may exceed 1 — the fee is per item).
   * No image upload exists in v1 (storage-gated) — text + colour
   * is the whole customisation.
   */
  pod: podSelectionSchema.optional(),
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
