/**
 * GET /api/v1/public/payment-methods — the payment methods a
 * customer may actually pick at checkout, computed from Admin >
 * Settings > Payments (payment.<method>.enabled / .mode) filtered
 * through the capability map in src/checkout/payment-methods:
 *
 *   · a gateway method appears ONLY when it is enabled AND an
 *     initiation path exists for its configured mode;
 *   · a manual method (Rocket) appears ONLY when it is fully
 *     configured — enabled AND the merchant number set — and the
 *     response carries the merchant number + verification: "manual"
 *     so the checkout can show the customer where to send money and
 *     be honest that staff verify the TrxID (never auto-confirmed);
 *   · methods with no adapter at all (aamarpay / shurjopay /
 *     stripe / paypal today) NEVER appear, even if a stale enabled
 *     flag exists in Settings — offering them would dead-end the
 *     customer at a "not_configured" initiation.
 *
 * COD is not listed here: it needs no initiation and the checkout
 * always offers it client-side. Public by design: the response is
 * method keys + display labels (+ the Rocket merchant number, a
 * receive-only number the store prints at checkout anyway — never
 * credentials), and the orders route re-validates the submitted
 * method server-side, so a forged list could not smuggle an
 * unconfigured method onto an order. NOT cached: an admin toggle
 * should reach the next checkout page load.
 */
import { NextResponse } from "next/server";
import {
  PAYMENT_METHOD_CAPABILITIES,
  isPaymentMethodVisibleAtCheckout,
  type PaymentMode,
} from "@/checkout/payment-methods";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Settings key holding a manual method's merchant number (the
 *  number customers send money to). Only Rocket is a manual-kind
 *  method today; a second one adds its entry here. */
const MANUAL_METHOD_NUMBER_KEY: Record<string, string> = {
  rocket: "payment.rocket.merchant_number",
};

interface PublicPaymentMethod {
  method: string;
  label: string;
  kind: "gateway" | "manual";
  /** Manual methods only: how the payment is confirmed. */
  verification?: "manual";
  /** Manual methods only: the merchant number to send money to. */
  merchantNumber?: string;
}

export async function GET() {
  const methods: PublicPaymentMethod[] = [];
  for (const cap of PAYMENT_METHOD_CAPABILITIES) {
    if (cap.kind === "manual") {
      const numberKey = MANUAL_METHOD_NUMBER_KEY[cap.method];
      if (!numberKey) continue;
      const enabled = (await getSetting(`payment.${cap.method}.enabled`)) === "true";
      const merchantNumber = ((await getSetting(numberKey)) ?? "").trim();
      // The configured verdict (enabled AND number present) rides
      // in the `enabled` slot for manual kinds — see the capability
      // map's visibility rule.
      const configured = enabled && merchantNumber !== "";
      if (isPaymentMethodVisibleAtCheckout(cap.method, { enabled: configured, mode: "live" })) {
        methods.push({
          method: cap.method,
          label: cap.label,
          kind: "manual",
          verification: "manual",
          merchantNumber,
        });
      }
      continue;
    }
    if (cap.kind !== "gateway") continue;
    const enabled = (await getSetting(`payment.${cap.method}.enabled`)) === "true";
    const rawMode = (await getSetting(`payment.${cap.method}.mode`)) ?? "sandbox";
    const mode: PaymentMode = rawMode === "live" ? "live" : "sandbox";
    if (isPaymentMethodVisibleAtCheckout(cap.method, { enabled, mode })) {
      methods.push({ method: cap.method, label: cap.label, kind: "gateway" });
    }
  }
  return NextResponse.json({
    data: { methods },
    meta: { db: "PRISMA", source: "SETTINGS" },
  });
}
