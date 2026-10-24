/**
 * Public payment-link view + sandbox pay initiation — Agent 19 (E1 follow-up).
 *
 * SECURITY RULES:
 * - A link is resolved ONLY by hashing the presented token and looking the
 *   hash up (InMemoryPaymentLinkStore.getByToken). A link id is NEVER
 *   accepted from the public — ids would be enumerable.
 * - The public view NEVER includes the token or the tokenHash.
 * - Paying is SANDBOX ONLY in this slice: initiation goes through Agent 9's
 *   sandbox gateway, which returns a simulated path on this app — no real
 *   gateway is called and no money moves. The link itself is NOT marked
 *   paid here; in the real flow that happens on verified gateway webhook
 *   (markPaymentLinkPaid), never on a browser click.
 */
import { formatBdt } from "@advance-ecommerce/validators";
import {
  createPaymentLink,
  demoPaymentLinkStore,
  verifyPaymentLinkToken,
  withEffectiveStatus,
  type PaymentLinkRecord,
  type PaymentLinkStatus,
} from "@/bd/payment-link";
import {
  createSandboxPaymentGateway,
  type SandboxPaymentMethod,
} from "@/integrations/sandbox/payment-gateway";

export const PAYMENT_LINK_STATUS_LABELS_BN: Record<PaymentLinkStatus, string> = {
  active: "পেমেন্ট বাকি আছে",
  paid: "পেমেন্ট হয়ে গেছে",
  expired: "লিংকের মেয়াদ শেষ",
  cancelled: "লিংক বাতিল করা হয়েছে",
};

const PURPOSE_LABELS_BN: Record<string, string> = {
  cod_advance: "অগ্রিম পেমেন্ট (ক্যাশ অন ডেলিভারি)",
  partial: "আংশিক পেমেন্ট",
  due: "বকেয়া পেমেন্ট",
};

export interface PayLinkPublicView {
  orderId: string;
  amountPoisha: number;
  amountFormatted: string;
  purpose: string;
  purposeLabelBn: string;
  status: PaymentLinkStatus;
  statusLabelBn: string;
  expiresAt: string;
  paidAt: string | null;
  isPayable: boolean;
}

export function buildPayLinkPublicView(record: PaymentLinkRecord, now: Date = new Date()): PayLinkPublicView {
  const effective = withEffectiveStatus(record, now);
  return {
    orderId: effective.orderId,
    amountPoisha: effective.amountPoisha,
    amountFormatted: formatBdt(effective.amountPoisha),
    purpose: effective.purpose,
    purposeLabelBn: PURPOSE_LABELS_BN[effective.purpose] ?? effective.purpose,
    status: effective.status,
    statusLabelBn: PAYMENT_LINK_STATUS_LABELS_BN[effective.status],
    expiresAt: effective.expiresAt,
    paidAt: effective.paidAt,
    isPayable: effective.status === "active",
  };
}

export type PayLinkResolveResult =
  | { ok: true; record: PaymentLinkRecord; view: PayLinkPublicView }
  | { ok: false; error: "not_found" };

/** Resolve by token ONLY (hash lookup + timing-safe verify belt-and-braces). */
export function resolvePayLink(token: string, now: Date = new Date()): PayLinkResolveResult {
  if (!token || token.length > 200) return { ok: false, error: "not_found" };
  const record = demoPaymentLinkStore.getByToken(token);
  if (!record || !verifyPaymentLinkToken(record, token)) return { ok: false, error: "not_found" };
  return { ok: true, record, view: buildPayLinkPublicView(record, now) };
}

export type SandboxPayResult =
  | { ok: true; sandbox: true; method: SandboxPaymentMethod; redirectUrl: string; paymentAttemptId: string }
  | { ok: false; error: string };

/**
 * Start a SANDBOX payment for an active link. `baseUrl` is the request
 * origin, used only as the simulated return/cancel target.
 */
export async function initiateSandboxPay(
  record: PaymentLinkRecord,
  input: { method: SandboxPaymentMethod; customerPhone: string; baseUrl: string },
): Promise<SandboxPayResult> {
  const effective = withEffectiveStatus(record);
  if (effective.status !== "active") {
    return { ok: false, error: PAYMENT_LINK_STATUS_LABELS_BN[effective.status] };
  }
  const gateway = createSandboxPaymentGateway(input.method);
  const result = await gateway.initiate({
    orderId: effective.orderId,
    amountPoisha: effective.amountPoisha,
    customerPhone: input.customerPhone,
    returnUrl: `${input.baseUrl}/track`,
    cancelUrl: `${input.baseUrl}/track`,
    // Stable per link+method: a double-click replays the same attempt.
    idempotencyKey: `plink-${effective.id}-${input.method}`,
  });
  return {
    ok: true,
    sandbox: true,
    method: input.method,
    // Sandbox gateway always returns its simulated path; the fallback
    // mirrors that same path shape if a future adapter returns null.
    redirectUrl: result.redirectUrl ?? `/sandbox/checkout/${input.method}?attempt=${result.paymentAttemptId}`,
    paymentAttemptId: result.paymentAttemptId,
  };
}

/* ------------------------------------------------------------------ */
/* TEMPORARY DEMO link — so /pay/<token> is reachable locally before     */
/* staff-created links exist in a real DB. The token below is a PUBLIC   */
/* demo string, not a secret; the record still stores only its hash.     */
/* Remove together with the in-memory store when payment_links lands.    */
/* ------------------------------------------------------------------ */

export const DEMO_PAY_TOKEN = "demo-pay-token-temporary";
let demoSeeded = false;

export function ensureDemoPaymentLink(): void {
  if (demoSeeded) return;
  demoSeeded = true;
  if (demoPaymentLinkStore.getByToken(DEMO_PAY_TOKEN)) return;
  const created = createPaymentLink(
    { orderId: "ORD-100244", amountPoisha: 50000, purpose: "cod_advance", ttlMinutes: 60 * 24 * 30 },
    { token: DEMO_PAY_TOKEN },
  );
  demoPaymentLinkStore.add(created.record);
}
