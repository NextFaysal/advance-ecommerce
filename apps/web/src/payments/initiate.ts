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
 *     · aamarpay / shurjopay / stripe / paypal — no adapter of any
 *       kind exists for them yet.
 *
 * LIVE ADAPTERS EXIST (ADV-4) for bkash (src/integrations/bkash/),
 * sslcommerz and nagad (src/payments/live-gateways.ts). When
 * payment.<method>.mode is "live" AND the merchant credentials are
 * (payment.bkash.username / .password / .app_key / .app_secret) are
 * complete in encrypted Settings, initiation dispatches to the real
 * bKash tokenized checkout and the returned URL is bKash's own
 * hosted page. Live mode with incomplete credentials returns
 * "not_configured" naming the missing credential fields — never a
 * silent fallback to the sandbox theatre: a customer must never be
 * sent to a simulated checkout believing it is real.
 *
 * UPAY + ROCKET (ADV-4 remainder):
 *   · upay — the real adapter (src/integrations/upay.ts) exists for
 *     BOTH provider environments, so upay dispatches to it in
 *     sandbox mode too (mode selects Upay's own test environment —
 *     there is NO app-simulated Upay theatre). Incomplete
 *     credentials → "not_configured" naming the missing fields.
 *     ⚠️ The Upay wire format is unverified against Upay's official
 *     merchant document — see src/integrations/upay/provider-http.ts.
 *   · rocket — a MANUAL method (src/payments/rocket-manual.ts):
 *     Rocket has no hosted checkout, so "initiation" here means the
 *     result carries the merchant Rocket number + instructions and
 *     status "manual_verification"; the customer sends money and
 *     submits a TrxID, and staff verify it in the review queue.
 *     Unconfigured (disabled or no merchant number) → the honest
 *     "not_configured" naming what is missing.
 *
 * Idempotency: the initiation key is stable per order + method
 * (`prepaid-<orderId>`), and the stores replay the persisted
 * attempt for a repeated key — a double call never creates two
 * attempts.
 */
import {
  createSandboxPaymentGateway,
  SANDBOX_PAYMENT_METHODS,
  type SandboxPaymentMethod,
} from "../integrations/sandbox/payment-gateway";
import {
  buildLiveBkashGateway,
  diagnoseBkash,
  type BkashSettingsReader,
} from "../integrations/bkash/resolver";
import { getIntegrationConfigWithSecrets, getSetting } from "../lib/settings";

/** Settings reader for the bKash resolver (ADV-4) — the lib/settings
 *  wiring lives here so the resolver module itself stays DB-free. */
export const bkashSettingsReader: BkashSettingsReader = {
  getSetting: (key) => getSetting(key),
  getProviderSecrets: (provider) => getIntegrationConfigWithSecrets("payment", provider),
};

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
  status: "initiated" | "not_configured" | "failed" | "manual_verification";
  url?: string;
  provider?: string;
  message?: string;
  /** Manual methods (Rocket): what the customer must do next. The
   *  merchant number is a receive-only number shown at checkout —
   *  never a credential. Present only with "manual_verification". */
  manual?: {
    method: string;
    merchantNumber: string;
    accountName: string | null;
    verification: "manual";
  };
};

const NO_ADAPTER_METHODS = new Set(["aamarpay", "shurjopay", "stripe", "paypal"]);

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
    if (method === "rocket") {
      // ADV-4 remainder: Rocket is a MANUAL method — no hosted
      // initiation exists. "Initiating" a Rocket order means handing
      // the customer the merchant number + the TrxID submission step;
      // the payment counts only after staff verify the TrxID in the
      // review queue (src/payments/rocket-manual.ts).
      const { getRocketManualConfig } = await import("./rocket-manual");
      const rocketConfig = await getRocketManualConfig();
      if (!rocketConfig.configured || rocketConfig.merchantNumber === null) {
        return {
          status: "not_configured",
          provider: method,
          message:
            "Rocket manual payment is not configured in Admin > Settings > Payments (missing: " +
            rocketConfig.missingFields.join(", ") +
            ") — the order stands, payment must be collected manually.",
        };
      }
      return {
        status: "manual_verification",
        provider: method,
        manual: {
          method: "rocket",
          merchantNumber: rocketConfig.merchantNumber,
          accountName: rocketConfig.accountName,
          verification: "manual",
        },
        message:
          "Rocket is a manual-verification method: the customer sends money to the merchant Rocket number and submits the TrxID; the payment counts only after staff verify it — nothing is auto-confirmed.",
      };
    }
    if (method === "upay") {
      // ADV-4 remainder: the REAL Upay adapter serves both provider
      // environments (there is no app-simulated Upay gateway), so
      // this branch runs before the sandbox-membership gate below.
      // Same live-guard semantics as the other live adapters:
      // disabled or incomplete credentials → not_configured naming
      // the missing fields, never a fake checkout.
      const upayEnabled = (await getSetting("payment.upay.enabled")) === "true";
      if (!upayEnabled) {
        return {
          status: "not_configured",
          provider: method,
          message:
            "upay is not enabled in Admin > Settings > Payments — the order stands, payment must be collected manually.",
        };
      }
      const { buildConfiguredPaymentGatewayFromSettings, diagnosePaymentProviderFromSettings } =
        await import("./live-gateways");
      const upayGateway = await buildConfiguredPaymentGatewayFromSettings("upay");
      if (upayGateway === null) {
        const diagnosis = await diagnosePaymentProviderFromSettings("upay");
        const missing = (diagnosis.missingFields ?? [])
          .map((f) => `payment.upay.${f}`)
          .join(", ");
        return {
          status: "not_configured",
          provider: method,
          message:
            "upay's merchant credentials are incomplete in Admin > Settings > Payments" +
            (missing ? ` (missing: ${missing})` : "") +
            " — initiation refused. The order stands; collect manually or complete the credentials.",
        };
      }
      const upayMode = (await getSetting("payment.upay.mode")) ?? "sandbox";
      const upayBase = appBaseUrl();
      const upayResult = await upayGateway.initiate({
        orderId: order.id,
        amountPoisha: order.totalPoisha,
        customerPhone: order.customerPhone,
        returnUrl: `${upayBase}/api/v1/public/payments/upay/callback`,
        cancelUrl: `${upayBase}/track`,
        idempotencyKey: `prepaid-${order.id}`,
      });
      if (upayResult.status === "FAILED" || !upayResult.redirectUrl) {
        return {
          status: "failed",
          provider: method,
          message:
            `Upay initiation for order ${order.orderNo} did not produce a checkout URL (attempt status ${upayResult.status}) — the order stands; collect manually or retry initiation.`,
        };
      }
      return {
        status: "initiated",
        url: upayResult.redirectUrl,
        provider: method,
        message:
          upayMode === "live"
            ? `LIVE Upay initiation for order ${order.orderNo}: real Upay hosted checkout — money moves when the customer completes payment.`
            : `Upay SANDBOX initiation for order ${order.orderNo}: Upay's own test environment (test money, no real funds move) — this is not the app-simulated sandbox.`,
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
      if (method === "bkash") {
        // ADV-4: the real bKash adapter. Configured = enabled + mode
        // live + complete credentials in encrypted Settings (the
        // live-guard semantics: never fake, never fall back).
        const gateway = await buildLiveBkashGateway(bkashSettingsReader);
        if (gateway === null) {
          const diagnosis = await diagnoseBkash(bkashSettingsReader);
          const missing = diagnosis.missingFields
            .map((f) => `payment.bkash.${f}`)
            .join(", ");
          return {
            status: "not_configured",
            provider: method,
            message:
              "bkash is set to LIVE mode but its merchant credentials are incomplete in Admin > Settings > Payments" +
              (missing ? ` (missing: ${missing})` : "") +
              " — initiation refused rather than falling back to the sandbox checkout. The order stands; collect manually or complete the credentials.",
          };
        }
        const liveBase = appBaseUrl();
        const liveResult = await gateway.initiate({
          orderId: order.id,
          amountPoisha: order.totalPoisha,
          customerPhone: order.customerPhone,
          returnUrl: `${liveBase}/track`,
          cancelUrl: `${liveBase}/track`,
          idempotencyKey: `prepaid-${order.id}`,
        });
        if (liveResult.status === "FAILED" || !liveResult.redirectUrl) {
          return {
            status: "failed",
            provider: method,
            message:
              `LIVE bKash initiation for order ${order.orderNo} did not produce a checkout URL (attempt status ${liveResult.status}) — the order stands; collect manually or retry initiation.`,
          };
        }
        return {
          status: "initiated",
          url: liveResult.redirectUrl,
          provider: method,
          message:
            `LIVE bKash initiation for order ${order.orderNo}: real bKash hosted checkout — money moves when the customer approves in bKash.`,
        };
      }
      if (method === "sslcommerz" || method === "nagad") {
        // ADV-4: real Nagad / SSLCommerz adapters (src/payments/
        // live-gateways.ts). Same live-guard semantics as bKash:
        // incomplete credentials → not_configured naming the missing
        // fields, never a sandbox fallback.
        const { buildConfiguredPaymentGatewayFromSettings, diagnosePaymentProviderFromSettings } =
          await import("./live-gateways");
        const liveGateway = await buildConfiguredPaymentGatewayFromSettings(method);
        if (liveGateway === null) {
          const diagnosis = await diagnosePaymentProviderFromSettings(method);
          const missing = (diagnosis.missingFields ?? [])
            .map((f) => `payment.${method}.${f}`)
            .join(", ");
          return {
            status: "not_configured",
            provider: method,
            message:
              `${method} is set to LIVE mode but its merchant credentials are incomplete in Admin > Settings > Payments` +
              (missing ? ` (missing: ${missing})` : "") +
              " — initiation refused rather than falling back to the sandbox checkout. The order stands; collect manually or complete the credentials.",
          };
        }
        const liveBase = appBaseUrl();
        const liveResult = await liveGateway.initiate({
          orderId: order.id,
          amountPoisha: order.totalPoisha,
          customerPhone: order.customerPhone,
          returnUrl: `${liveBase}/api/v1/public/payments/${method}/callback`,
          cancelUrl: `${liveBase}/track`,
          idempotencyKey: `prepaid-${order.id}`,
        });
        if (liveResult.status === "FAILED" || !liveResult.redirectUrl) {
          return {
            status: "failed",
            provider: method,
            message:
              `LIVE ${method} initiation for order ${order.orderNo} did not produce a checkout URL (attempt status ${liveResult.status}) — the order stands; collect manually or retry initiation.`,
          };
        }
        return {
          status: "initiated",
          url: liveResult.redirectUrl,
          provider: method,
          message:
            `LIVE ${method} initiation for order ${order.orderNo}: real ${method} hosted checkout — money moves when the customer completes payment.`,
        };
      }
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
