/**
 * GET /api/v1/public/payment-methods — the gateway payment methods a
 * customer may actually pick at checkout, computed from Admin >
 * Settings > Payments (payment.<method>.enabled / .mode) filtered
 * through the capability map in src/checkout/payment-methods:
 *
 *   · a method appears ONLY when it is enabled AND an initiation
 *     path exists for its configured mode;
 *   · methods with no adapter at all (rocket / upay / aamarpay /
 *     shurjopay / stripe / paypal today) NEVER appear, even if a
 *     stale enabled flag exists in Settings — offering them would
 *     dead-end the customer at a "not_configured" initiation.
 *
 * COD is not listed here: it needs no initiation and the checkout
 * always offers it client-side. Public by design: the response is
 * method keys + display labels only (no credentials, no config), and
 * the orders route re-validates the submitted method server-side, so
 * a forged list could not smuggle an unconfigured method onto an
 * order. NOT cached: an admin toggle should reach the next checkout
 * page load.
 */
import { NextResponse } from "next/server";
import {
  PAYMENT_METHOD_CAPABILITIES,
  isPaymentMethodVisibleAtCheckout,
  type PaymentMode,
} from "@/checkout/payment-methods";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const methods: { method: string; label: string }[] = [];
  for (const cap of PAYMENT_METHOD_CAPABILITIES) {
    if (cap.kind !== "gateway") continue;
    const enabled = (await getSetting(`payment.${cap.method}.enabled`)) === "true";
    const rawMode = (await getSetting(`payment.${cap.method}.mode`)) ?? "sandbox";
    const mode: PaymentMode = rawMode === "live" ? "live" : "sandbox";
    if (isPaymentMethodVisibleAtCheckout(cap.method, { enabled, mode })) {
      methods.push({ method: cap.method, label: cap.label });
    }
  }
  return NextResponse.json({
    data: { methods },
    meta: { db: "PRISMA", source: "SETTINGS" },
  });
}
