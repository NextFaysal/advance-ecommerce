/**
 * Prepaid payment initiation — doc 17 batch O3.
 *
 * Before this module, a customer who picked a prepaid method
 * (bKash / Nagad / SSLCommerz / …) at checkout got an order and a
 * promise — "we'll call you" — because NOTHING initiated the payment.
 * initiatePrepaidPayment() is the one entry point the create flow
 * calls (post-commit, fire-and-degrade: it NEVER throws, so a gateway
 * problem can never fail an order that already exists) to start the
 * hosted payment and hand back a URL for the customer.
 *
 * WHAT HAPPENS TODAY (honest):
 * - The only gateway adapters in the codebase are the SANDBOX ones
 *   (src/integrations/sandbox/payment-gateway.ts: bkash, nagad,
 *   sslcommerz). A sandbox initiation creates a real PaymentAttempt
 *   row and returns the SIMULATED hosted-checkout path on this app
 *   (/sandbox/checkout/<method>) — plastic money theatre: no real
 *   gateway is called and no real money moves. The result says so:
 *   status "initiated" with a message that names it sandbox.
 * - A method is only initiated when it is ENABLED in Admin >
 *   Settings > Payments (payment.<method>.enabled; the settings UI's
 *   own default is disabled) and its mode is "sandbox". Everything
 *   else returns "not_configured":
 *     · cod — nothing to initiate (collect on delivery);
 *     · manual_mobile_banking — the customer submits a TrxID instead
 *       (the manual-Trx funnel owns that flow);
 *     · aamarpay / shurjopay / rocket / upay / stripe / paypal — no
 *       adapter of any kind exists for them yet;
 *     · mode "live" — NO live adapter exists in this codebase at
 *       all, with or without credentials (see below).
 *
 * WHAT CHANGES WHEN NAZMUL ADDS LIVE MERCHANT CREDENTIALS:
 * Saving credentials in Settings (payment.<method>.api_key / .secret
 * …) and flipping the mode to "live" is NOT sufficient by itself —
 * a real provider adapter implementing the PaymentGateway interface
 * (src/integrations/payment.ts) must be written per provider and
 * selected here in place of the sandbox factory. Until that adapter
 * lands, mode "live" deliberately returns "not_configured" rather
 * than silently falling back to the sandbox theatre: a customer must
 * never be sent to a simulated checkout believing it is real.
 *
 * Idempotency: the initiation key is stable per order + method
 * (`prepaid-<orderId>`), and the sandbox store replays the persisted
 * attempt for a repeated key — a double call never creates two
 * attempts.
 */
import {
  createSandboxPaymentGateway,
  SANDBOX_PAYMENT_METHODS,
  type SandboxPaymentMethod,
} from "../integrations/sandbox/payment-gateway";
import { getSetting } from "../lib/settings";

export interface PrepaidOrderRef {
  id: string;
  orderNo: string;
  /** Integer poisha — the full order total (prepaid = pay in full). */
  totalPoisha: number;
  /** Checkout method string: "cod" | "bkash" | "nagad" | "sslcommerz" | … */
  paymentMethod: string;
  customerPhone: string;
}

export type InitiatePrepaidResult = {
  status: "initiated" | "not_configured" | "failed";
  url?: string;
  provider?: string;
  message?: string;
};

const NO_ADAPTER_METHODS = new Set(["aamarpay", "shurjopay", "rocket", "upay", "stripe", "paypal"]);

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function initiatePrepaidPayment(order: PrepaidOrderRef): Promise<InitiatePrepaidResult> {
  const method = order.paymentMethod.trim().toLowerCase();
  try {
    if (method === "cod") {
      return {
        status: "not_configured",
        provider: "cod",
        message: "COD orders need no online payment initiation — the amount is collected on delivery.",
      };
    }
    if (method === "manual_mobile_banking" || method === "manual") {
      return {
        status: "not_configured",
        provider: "manual_mobile_banking",
        message: "Manual mobile banking is collected via customer TrxID submission, not a hosted initiation.",
      };
    }
    if (NO_ADAPTER_METHODS.has(method)) {
      return {
        status: "not_configured",
        provider: method,
        message: `No payment gateway adapter exists for ${method} yet — the order stands, payment must be collected manually.`,
      };
    }
    if (!(SANDBOX_PAYMENT_METHODS as readonly string[]).includes(method)) {
      return {
        status: "not_configured",
        provider: method,
        message: `Unknown payment method "${method}" — nothing initiated.`,
      };
    }
    const sandboxMethod = method as SandboxPaymentMethod;

    const enabled = (await getSetting(`payment.${method}.enabled`)) === "true";
    if (!enabled) {
      return {
        status: "not_configured",
        provider: method,
        message: `${method} is not enabled in Admin > Settings > Payments — the order stands, payment must be collected manually.`,
      };
    }

    const mode = (await getSetting(`payment.${method}.mode`)) ?? "sandbox";
    if (mode === "live") {
      return {
        status: "not_configured",
        provider: method,
        message:
          `${method} is set to LIVE mode, but no live gateway adapter exists in this codebase yet — ` +
          "initiation refused rather than falling back to the sandbox checkout. The order stands; collect manually or switch the method back to sandbox for testing.",
      };
    }

    const base = appBaseUrl();
    const gateway = createSandboxPaymentGateway(sandboxMethod);
    const result = await gateway.initiate({
      orderId: order.id,
      amountPoisha: order.totalPoisha,
      customerPhone: order.customerPhone,
      returnUrl: `${base}/track`,
      cancelUrl: `${base}/track`,
      idempotencyKey: `prepaid-${order.id}`,
    });
    const url = result.redirectUrl ?? `/sandbox/checkout/${method}?attempt=${result.paymentAttemptId}`;
    return {
      status: "initiated",
      url: url.startsWith("http") ? url : `${base}${url}`,
      provider: method,
      message:
        `SANDBOX initiation for order ${order.orderNo}: simulated ${method} checkout on this app — ` +
        "no real gateway was called and no money moves. A live adapter + merchant credentials in Settings are required for real collection.",
    };
  } catch (error) {
    // Never throw into the create flow: the order already exists; a
    // failed initiation degrades to meta the caller can surface.
    return {
      status: "failed",
      provider: method,
      message: `Payment initiation failed (${error instanceof Error ? error.name : "unknown-error"}) — the order stands; collect manually or retry initiation.`,
    };
  }
}
