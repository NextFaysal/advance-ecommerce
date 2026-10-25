// Manual order — phone/Facebook/WhatsApp/call orders entered by staff.
// Target: <= 30 seconds (customer lookup by phone -> add items -> address ->
// payment -> confirm). Defaults are prefilled so the form is mostly taps.
// Zod reuses the checkout address/phone rules; this is a staff-side shortcut,
// not a second checkout implementation.
//
// V2 (doc 17 batch O2): the builder now carries the same money fields the
// public checkout computes — a shipping method charged at the public
// checkout rates (or a staff override), and an optional coupon code the
// admin route evaluates through the SAME evaluateOrderCoupon path as
// public checkout. Item prices stay staff-entered (negotiated phone
// prices are a feature of this channel — overrides are recorded on the
// order note by the route).
import { z } from "zod";
import { bdAddressSchema, BD_PHONE_REGEX } from "../checkout/validation";
import {
  calculateShipping,
  DEFAULT_SHIPPING_RATES,
  type ShippingZone,
} from "../checkout/shipping-core";

/**
 * Delivery charge for manual orders — UNIFIED with the public
 * checkout shipping engine (doc 17 O2, src/checkout/shipping-core.ts):
 * this helper no longer mirrors a private copy of the rates. It runs
 * the engine's pure calculator with the method as the explicit zone.
 * Manual orders carry no weight data, so totalWeightGrams is 0 (no
 * slab surcharge), and the staff override
 * (shippingOverridePoisha below) still wins over whatever this
 * returns — the admin route applies it after calling here.
 *
 * The signature stays synchronous because the builder calls it during
 * render, so it prices from DEFAULT_SHIPPING_RATES (the Settings
 * fallbacks); the public route's async computeOrderShipping() is the
 * path that reads live Settings overrides.
 */
export type ManualShippingMethod = ShippingZone;

export function manualShippingPoisha(method: ManualShippingMethod): number {
  return calculateShipping(DEFAULT_SHIPPING_RATES, {
    zone: method,
    shippingMethod: method,
    totalWeightGrams: 0,
    subtotalPoisha: 0,
  }).shippingPoisha;
}

export const manualOrderSchema = z.object({
  phone: z.string().refine((v) => BD_PHONE_REGEX.test(v.replace(/[\s-]/g, "")), {
    message: "Sothik Bangladesh mobile number din",
  }),
  customerName: z.string().min(2, "Nam dite hobe"),
  /**
   * Optional: the existing Customer row id when staff picked the caller
   * from the phone lookup. Bookkeeping only — the create path still
   * resolves the customer by normalized phone (find-or-create), exactly
   * like public checkout, so a stale id can never split one caller into
   * two customers.
   */
  customerId: z.string().min(1).optional(),
  address: bdAddressSchema,
  items: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.number().int().positive(),
        /** Staff may set a custom price/discount; recorded in order history. */
        unitPricePoisha: z.number().int().nonnegative(),
      }),
    )
    .min(1, "Ontoto ekti item add korun"),
  paymentMethod: z.enum(["cod", "bkash", "nagad"]),
  /**
   * Delivery zone for the charge. Optional for API compatibility —
   * the admin route treats an absent method as "inside_dhaka" (the
   * common phone-order case) and says so in its response meta.
   */
  shippingMethod: z.enum(["inside_dhaka", "outside_dhaka", "pickup"]).optional(),
  /**
   * Staff-set delivery charge (poisha) replacing the method rate —
   * e.g. free delivery promised on the call, or a heavy-item surcharge.
   * When present it is the base shipping the coupon evaluation sees
   * (a free-shipping coupon can still zero it, same as public
   * checkout), and the override is recorded on the order note.
   */
  shippingOverridePoisha: z.number().int().nonnegative().optional(),
  /**
   * Optional coupon code — evaluated server-side by the admin route
   * through evaluateOrderCoupon (src/checkout/order-enrichment), the
   * same evaluator public checkout uses. An ineligible code never
   * fails the order; the outcome rides in the response meta.
   */
  couponCode: z.string().max(64).optional(),
  note: z.string().max(500).optional(),
  /**
   * Delivery slot id (doc 17 batch O9-2): one of the ids in Settings
   * orders.delivery_slots. Permissive here — manual-create resolves
   * it against the configured set and persists only a match, exactly
   * like public checkout (a stale id from a saved draft drops
   * silently at conversion instead of failing the order).
   */
  deliverySlotId: z.string().max(64).optional(),
  /** Gift message (doc 17 batch O9-2): present (possibly "") only
   *  when the caller asked for a gift; persisted verbatim on
   *  Order.giftMessage. No gift-wrap fee exists. */
  giftMessage: z.string().max(500).optional(),
});

export type ManualOrderInput = z.infer<typeof manualOrderSchema>;

/** The five taps/steps of the manual-order flow, in order. */
export const MANUAL_ORDER_STEPS = [
  "Customer lookup (phone)",
  "Add items",
  "Address",
  "Payment method",
  "Confirm",
] as const;
