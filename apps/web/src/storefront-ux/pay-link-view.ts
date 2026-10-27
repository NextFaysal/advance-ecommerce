/**
 * Public payment-link view + sandbox pay initiation — Agent 19 (E1 follow-up).
 *
 * SECURITY RULES:
 * - A link is resolved ONLY by hashing the presented token and looking the
 *   hash up (paymentLinkStore.getByToken — payment_links table, DB swap
 *   2026-10-24). A link id is NEVER accepted from the public — ids would
 *   be enumerable.
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
  paymentLinkStore,
  verifyPaymentLinkToken,
  withEffectiveStatus,
  type PaymentLinkRecord,
  type PaymentLinkStatus,
} from "@/bd/payment-link";
import {
  createSandboxPaymentGateway,
  type SandboxPaymentMethod,
} from "@/integrations/sandbox/payment-gateway";
import { pick, type Locale } from "@/i18n/locale";

export const PAYMENT_LINK_STATUS_LABELS_BN: Record<PaymentLinkStatus, string> = {
  active: "পেমেন্ট বাকি আছে",
  paid: "পেমেন্ট হয়ে গেছে",
  expired: "লিংকের মেয়াদ শেষ",
  cancelled: "লিংক বাতিল করা হয়েছে",
};

export const PAYMENT_LINK_STATUS_LABELS_EN: Record<PaymentLinkStatus, string> = {
  active: "Payment pending",
  paid: "Payment completed",
  expired: "Link expired",
  cancelled: "Link cancelled",
};

/** Doc 30: locale-keyed label records — pick(locale, …) selects the set. */
export const PAYMENT_LINK_STATUS_LABELS: Record<Locale, Record<PaymentLinkStatus, string>> = {
  bn: PAYMENT_LINK_STATUS_LABELS_BN,
  en: PAYMENT_LINK_STATUS_LABELS_EN,
};

const PURPOSE_LABELS_BN: Record<string, string> = {
  cod_advance: "অগ্রিম পেমেন্ট (ক্যাশ অন ডেলিভারি)",
  partial: "আংশিক পেমেন্ট",
  due: "বকেয়া পেমেন্ট",
};

const PURPOSE_LABELS_EN: Record<string, string> = {
  cod_advance: "Advance payment (Cash on Delivery)",
  partial: "Partial payment",
  due: "Due payment",
};

export const PAYMENT_LINK_PURPOSE_LABELS: Record<Locale, Record<string, string>> = {
  bn: PURPOSE_LABELS_BN,
  en: PURPOSE_LABELS_EN,
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

export function buildPayLinkPublicView(
  record: PaymentLinkRecord,
  now: Date = new Date(),
  /** Doc 30: label language (the *LabelBn fields carry it; names kept
   *  for compatibility with existing consumers). Default bn = legacy. */
  locale: Locale = "bn",
): PayLinkPublicView {
  const effective = withEffectiveStatus(record, now);
  const purposeLabels = pick(locale, PAYMENT_LINK_PURPOSE_LABELS);
  const statusLabels = pick(locale, PAYMENT_LINK_STATUS_LABELS);
  return {
    orderId: effective.orderId,
    amountPoisha: effective.amountPoisha,
    amountFormatted: formatBdt(effective.amountPoisha),
    purpose: effective.purpose,
    purposeLabelBn: purposeLabels[effective.purpose] ?? effective.purpose,
    status: effective.status,
    statusLabelBn: statusLabels[effective.status],
    expiresAt: effective.expiresAt,
    paidAt: effective.paidAt,
    isPayable: effective.status === "active",
  };
}

export type PayLinkResolveResult =
  | { ok: true; record: PaymentLinkRecord; view: PayLinkPublicView }
  | { ok: false; error: "not_found" };

/** Resolve by token ONLY (hash lookup + timing-safe verify belt-and-braces). */
export async function resolvePayLink(token: string, now: Date = new Date(), locale: Locale = "bn"): Promise<PayLinkResolveResult> {
  if (!token || token.length > 200) return { ok: false, error: "not_found" };
  const record = await paymentLinkStore.getByToken(token);
  if (!record || !verifyPaymentLinkToken(record, token)) return { ok: false, error: "not_found" };
  return { ok: true, record, view: buildPayLinkPublicView(record, now, locale) };
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
  locale: Locale = "bn",
): Promise<SandboxPayResult> {
  const effective = withEffectiveStatus(record);
  if (effective.status !== "active") {
    return { ok: false, error: pick(locale, PAYMENT_LINK_STATUS_LABELS)[effective.status] };
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
/* staff-created links exist. The token below is a PUBLIC demo string,  */
/* not a secret; the record still stores only its hash.                */
/*                                                                     */
/* DB swap note (2026-10-24): payment_links rows require a real Order  */
/* FK, so the demo link is now seeded ONLY when the demo order          */
/* (ORD-100244) actually exists in the database; otherwise this is a   */
/* no-op and the demo token resolves as not_found, like any unknown    */
/* token. Delete together with DEMO_PAY_TOKEN once staff-created       */
/* links are the only flow.                                            */
/* ------------------------------------------------------------------ */

export const DEMO_PAY_TOKEN = "demo-pay-token-temporary";
let demoSeeded = false;

export async function ensureDemoPaymentLink(): Promise<void> {
  if (demoSeeded) return;
  demoSeeded = true;
  try {
    if (await paymentLinkStore.getByToken(DEMO_PAY_TOKEN)) return;
    const created = createPaymentLink(
      { orderId: "ORD-100244", amountPoisha: 50000, purpose: "cod_advance", ttlMinutes: 60 * 24 * 30 },
      { token: DEMO_PAY_TOKEN },
    );
    await paymentLinkStore.add(created.record);
  } catch {
    // Demo order not in the DB (or DB unavailable): no demo link. The
    // public page handles the not_found state; staff-created links are
    // unaffected.
  }
}
