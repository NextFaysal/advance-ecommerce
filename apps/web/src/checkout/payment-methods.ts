/**
 * Payment-method capability map — the SINGLE SOURCE for one question:
 * "may a customer pick this payment method at checkout?"
 *
 * WHY THIS EXISTS (ADV-4 checkout honesty fix, doc 21 §1):
 * The checkout used to hardcode its method tiles, so AamarPay and
 * ShurjoPay were offered to every customer although NO adapter of any
 * kind exists for them (src/payments/initiate.ts returns
 * "not_configured" for rocket / upay / aamarpay / shurjopay / stripe /
 * paypal) — customers picked them and dead-ended. The rule now:
 *
 *   · kind "always" (cod, manual TrxID) — no hosted initiation is
 *     involved, so the method is always offerable, exactly as today.
 *   · kind "gateway" — offerable ONLY when the method is enabled in
 *     Admin > Settings > Payments AND this map says a working
 *     initiation path exists for the configured mode.
 *   · kind "manual" (rocket) — a manual mobile-banking method with
 *     staff verification (src/payments/rocket-manual.ts): offerable
 *     ONLY when configured — enabled AND the merchant number set.
 *     The public route computes that verdict server-side and passes
 *     it in the `enabled` slot of the visibility check below.
 *
 * WHO READS THIS MAP:
 *   · GET /api/v1/public/payment-methods computes the customer-visible
 *     gateway list from Settings + this map (server-side).
 *   · The checkout page renders only what that endpoint returns (+ COD).
 *   · Admin > Settings > Payments uses it to badge adapter-less
 *     methods "অ্যাডাপ্টার তৈরি হয়নি" and lock their enable control.
 *
 * WHEN A NEW ADAPTER LANDS: flip that method's adapterModes entry
 * here — one line. src/payments/initiate.ts stays the runtime
 * authority: if it ever answers "not_configured" anyway (stale page,
 * direct API call, mode flipped ahead of the adapter), the checkout
 * confirmation surfaces ADAPTER_NOT_LIVE_MESSAGE_BN instead of a raw
 * code, and the order itself is never failed by a payment problem.
 *
 * This module is pure data + pure functions — client-safe, no server
 * imports — so the storefront, the admin page and the public route
 * all share the exact same rule.
 */

export type PaymentMode = "sandbox" | "live";

export interface PaymentMethodCapability {
  /** Canonical method key (matches Settings payment.<method>.* and initiate.ts). */
  method: string;
  /** Brand label, language-neutral (tiles pair it with brand marks). */
  label: string;
  /**
   * "always"  — no hosted initiation path is needed (COD is collected
   *             on delivery; manual mobile banking is collected via
   *             the customer's TrxID submission flow).
   * "gateway" — the customer is handed to a hosted gateway; the
   *             method may be offered only per adapterModes + enabled.
   * "manual"  — a named manual mobile-banking method (Rocket): the
   *             customer sends money to the merchant's number and
   *             submits a TrxID; staff verify it in the review queue.
   *             Offerable only when fully configured — the caller
   *             (the public payment-methods route) passes the
   *             configured verdict in the `enabled` slot.
   */
  kind: "always" | "gateway" | "manual";
  /**
   * Gateway methods only: in which modes a working initiation path
   * exists. bkash/nagad/sslcommerz have the sandbox adapters today
   * and their live adapters land under doc 22 ADV-4; every other
   * gateway method has NO adapter in any mode and stays hidden until
   * its adapter ships and this entry is flipped.
   */
  adapterModes: Record<PaymentMode, boolean> | null;
}

export const PAYMENT_METHOD_CAPABILITIES: readonly PaymentMethodCapability[] = [
  { method: "cod", label: "Cash on Delivery", kind: "always", adapterModes: null },
  { method: "manual_mobile_banking", label: "Manual Mobile Banking (TrxID)", kind: "always", adapterModes: null },
  { method: "bkash", label: "bKash", kind: "gateway", adapterModes: { sandbox: true, live: true } },
  { method: "nagad", label: "Nagad", kind: "gateway", adapterModes: { sandbox: true, live: true } },
  { method: "sslcommerz", label: "SSLCommerz", kind: "gateway", adapterModes: { sandbox: true, live: true } },
  { method: "rocket", label: "Rocket", kind: "manual", adapterModes: null },
  // Upay has NO app-simulated sandbox adapter: both modes dispatch
  // to the REAL adapter (src/integrations/upay.ts) pointed at
  // Upay's own sandbox / live environment, exactly like the other
  // gateways' live branch. adapterModes true = an initiation path
  // exists in that mode (credentials still gate it at initiation).
  { method: "upay", label: "Upay", kind: "gateway", adapterModes: { sandbox: true, live: true } },
  { method: "aamarpay", label: "AamarPay", kind: "gateway", adapterModes: { sandbox: false, live: false } },
  { method: "shurjopay", label: "ShurjoPay", kind: "gateway", adapterModes: { sandbox: false, live: false } },
  { method: "stripe", label: "Stripe", kind: "gateway", adapterModes: { sandbox: false, live: false } },
  { method: "paypal", label: "PayPal", kind: "gateway", adapterModes: { sandbox: false, live: false } },
];

export const PAYMENT_METHOD_CAPABILITY_BY_KEY: ReadonlyMap<string, PaymentMethodCapability> = new Map(
  PAYMENT_METHOD_CAPABILITIES.map((cap) => [cap.method, cap]),
);

function capabilityOf(method: string): PaymentMethodCapability | undefined {
  return PAYMENT_METHOD_CAPABILITY_BY_KEY.get(method.trim().toLowerCase());
}

/** True when a hosted gateway adapter exists for the method in ANY mode. */
export function paymentMethodHasAdapter(method: string): boolean {
  const cap = capabilityOf(method);
  if (!cap || cap.kind !== "gateway" || !cap.adapterModes) return false;
  return cap.adapterModes.sandbox || cap.adapterModes.live;
}

/**
 * True for gateway methods with NO adapter — the set Admin > Settings
 * must badge "অ্যাডাপ্টার তৈরি হয়নি" and never let staff enable for
 * checkout. COD/manual are NOT in this set: they need no adapter.
 */
export function isAdapterlessGatewayMethod(method: string): boolean {
  const cap = capabilityOf(method);
  return cap?.kind === "gateway" && !paymentMethodHasAdapter(method);
}

/**
 * The checkout visibility rule (method × enabled × mode → visible):
 *   · unknown method        → hidden
 *   · kind "always"         → visible (enabled/mode irrelevant)
 *   · kind "manual"         → visible only when configured; the
 *                             caller passes the CONFIGURED verdict
 *                             (enabled AND merchant number present,
 *                             computed server-side) as `enabled`.
 *   · gateway, disabled     → hidden
 *   · gateway, enabled      → visible only in a mode with an adapter
 */
export function isPaymentMethodVisibleAtCheckout(
  method: string,
  config: { enabled: boolean; mode: PaymentMode },
): boolean {
  const cap = capabilityOf(method);
  if (!cap) return false;
  if (cap.kind === "always") return true;
  if (cap.kind === "manual") return config.enabled;
  if (!config.enabled) return false;
  return cap.adapterModes?.[config.mode] === true;
}

/** Admin badge for adapter-less methods (shown next to the locked enable control). */
export const ADAPTER_NOT_BUILT_BN = "অ্যাডাপ্টার তৈরি হয়নি";

/**
 * Confirmation-screen notice when initiation reports not_configured
 * for a non-COD order (adapter-less method attempted from a stale
 * page or a direct API call, or a mode flipped live ahead of its
 * adapter): plain Bangla, no raw status codes, and honest that the
 * order itself was received.
 */
export const PAYMENT_NOT_LIVE_MESSAGE_BN =
  "এই পেমেন্ট পদ্ধতি এখনো চালু হয়নি — তবে আপনার অর্ডারটি গৃহীত হয়েছে। পেমেন্টের জন্য আমাদের টিম ফোনে যোগাযোগ করবে।";
