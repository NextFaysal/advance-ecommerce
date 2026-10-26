/**
 * Rocket MANUAL payment — ADV-4 remainder (doc 22).
 *
 * Rocket (Dutch-Bangla Bank) has no public hosted-checkout API
 * comparable to bKash tokenized / SSLCommerz / Nagad, so Rocket is
 * implemented the way Bangladeshi stores actually take it: as a
 * MANUAL mobile-banking method with staff verification.
 *
 * THE FLOW:
 *  1. Checkout offers Rocket ONLY when it is configured:
 *     `payment.rocket.enabled` is "true" AND the merchant Rocket
 *     number `payment.rocket.merchant_number` is set in Admin >
 *     Settings. The number is shown to the customer (it is a
 *     receive-only number, printed on the checkout/confirmation —
 *     not a credential).
 *  2. The customer sends money to that number in their Rocket app
 *     and submits (TrxID, sender number, amount) via
 *     POST /api/v1/public/payments/rocket/trx.
 *  3. The submission persists a PAIR of records:
 *       - a ManualTrxSubmission (method "rocket", status PENDING) —
 *         this is the PENDING_VERIFICATION record staff see in the
 *         EXISTING review queue (Admin > Payments, the same surface
 *         that reviews bKash/Nagad manual TrxIDs), with the same
 *         duplicate rule: UNIQUE(method, trxId) can never approve
 *         twice;
 *       - a Payment + PaymentAttempt (method "rocket", status
 *         UNPAID, amountPoisha = the claimed amount,
 *         gatewayTransactionId = the normalised TrxID), LINKED to
 *         the submission via ManualTrxSubmission.paymentId.
 *  4. Staff approve/reject in the review queue
 *     (src/integrations/sandbox/manual-trx.ts reviewManualTrx). For
 *     a linked Rocket submission, approval is allowed ONLY when the
 *     attempt amount equals the claimed amount exactly, and it flips
 *     the attempt through the shared funnel —
 *     applyAttemptStatus(attempt, "PAID", exactAmount) — then the
 *     order funnel (markOrderPayment) re-derives the order status.
 *     Rejection flips the attempt to FAILED. The money is counted
 *     EXACTLY ONCE: money-math aggregates sum APPROVED submissions
 *     only when they are NOT payment-linked (paymentId: null), so a
 *     Rocket payment counts via its Payment row alone.
 *
 * HONESTY: nothing here auto-confirms. A submission is a CLAIM by
 * the customer until a staff member verifies the TrxID against the
 * merchant Rocket account and approves it; API responses say
 * "pending_verification" / verification "manual", never "paid".
 * Rocket has no SMS auto-verify either — the SMS Trx registry
 * (src/bd/) parses bKash/Nagad merchant SMS only.
 */
import { prisma } from "@advance-ecommerce/db";
import { z } from "zod";
import type { ManualTrxSubmission } from "../integrations/payment";
import {
  SandboxOrderNotFoundError,
  createManualTrxRow,
  findManualTrxByMethodAndTrxDb,
} from "../integrations/sandbox/db-store";
import { hash8 } from "../integrations/sandbox/deterministic";
import { normalizeTrxId } from "../integrations/sandbox/store";
import { getSetting } from "../lib/settings";
import { liveAttemptId, prismaLivePaymentStore } from "./live-store";

export interface RocketManualConfig {
  enabled: boolean;
  /** Merchant Rocket number customers send money to. Public by
   *  design (shown at checkout); null when unset. */
  merchantNumber: string | null;
  /** Account holder name shown next to the number, when set. */
  accountName: string | null;
  /** enabled AND merchant number present — the checkout gate. */
  configured: boolean;
  /** Config pieces still missing (Settings keys, for diagnostics). */
  missingFields: string[];
}

export async function getRocketManualConfig(
  reader: { getSetting(key: string): Promise<string | null> } = { getSetting },
): Promise<RocketManualConfig> {
  const safe = async (key: string): Promise<string | null> => {
    try {
      return await reader.getSetting(key);
    } catch {
      return null;
    }
  };
  const enabled = (await safe("payment.rocket.enabled")) === "true";
  const merchantNumberRaw = (await safe("payment.rocket.merchant_number")) ?? "";
  const merchantNumber = merchantNumberRaw.trim() === "" ? null : merchantNumberRaw.trim();
  const accountNameRaw = (await safe("payment.rocket.account_name")) ?? "";
  const missingFields: string[] = [];
  if (!enabled) missingFields.push("payment.rocket.enabled");
  if (merchantNumber === null) missingFields.push("payment.rocket.merchant_number");
  return {
    enabled,
    merchantNumber,
    accountName: accountNameRaw.trim() === "" ? null : accountNameRaw.trim(),
    configured: enabled && merchantNumber !== null,
    missingFields,
  };
}

export const rocketTrxSubmitSchema = z.object({
  /** Order id or orderNo — resolved server-side. */
  orderId: z.string().min(1),
  trxId: z.string().min(6).max(32),
  senderPhone: z.string().min(11).max(15),
  /** Integer poisha claimed by the customer. */
  amountPoisha: z.number().int().positive(),
});

export type RocketTrxSubmitInput = z.infer<typeof rocketTrxSubmitSchema>;

export type SubmitRocketTrxResult =
  | {
      ok: true;
      submission: ManualTrxSubmission;
      /** The linked PaymentAttempt id (status UNPAID until staff
       *  approve the submission in the review queue). */
      paymentAttemptId: string;
      /** Always "pending_verification" on success — never "paid". */
      state: "pending_verification";
    }
  | { ok: false; code: string; error: string };

/**
 * Record a customer's Rocket payment claim: the linked
 * submission + attempt pair described in the module header.
 * Duplicate (rocket, TrxID) submissions are refused before any
 * attempt is created; a race that still hits the UNIQUE backstop
 * fails the just-created attempt so no orphan UNPAID attempt is
 * left pointing at money nobody claimed.
 */
export async function submitRocketTrx(raw: unknown): Promise<SubmitRocketTrxResult> {
  const parsed = rocketTrxSubmitSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT", error: "Invalid Rocket TrxID submission." };
  }
  const input = parsed.data;

  const config = await getRocketManualConfig();
  if (!config.configured) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      error:
        "Rocket manual payment is not configured for this store (missing: " +
        config.missingFields.join(", ") +
        ").",
    };
  }

  const order = await prisma.order.findFirst({
    where: { deletedAt: null, OR: [{ id: input.orderId }, { orderNo: input.orderId }] },
    select: { id: true, orderNo: true, paymentMethod: true, paymentStatus: true, totalPoisha: true },
  });
  if (!order) {
    return { ok: false, code: "ORDER_NOT_FOUND", error: "Order not found for this submission." };
  }
  if (order.paymentMethod !== "ROCKET" && order.paymentMethod !== "MANUAL_MOBILE_BANKING") {
    return {
      ok: false,
      code: "WRONG_METHOD",
      error: "This order was not placed with Rocket / manual mobile banking.",
    };
  }
  if (order.paymentStatus === "PAID" || order.paymentStatus === "REFUNDED") {
    return {
      ok: false,
      code: "ALREADY_PAID",
      error: "This order is already fully paid — no Rocket submission is needed.",
    };
  }
  if (input.amountPoisha > order.totalPoisha) {
    return {
      ok: false,
      code: "AMOUNT_EXCEEDS_TOTAL",
      error: "Claimed amount exceeds the order total.",
    };
  }

  const duplicate = await findManualTrxByMethodAndTrxDb("rocket", input.trxId);
  if (duplicate) {
    return { ok: false, code: "DUPLICATE_TRX", error: "Duplicate TrxID for this method." };
  }

  const normalizedTrx = normalizeTrxId(input.trxId);
  const attemptId = liveAttemptId("rocket", `rocket-trx:${order.id}:${normalizedTrx}`);
  const attempt = await prismaLivePaymentStore.getOrCreateAttempt({
    method: "rocket",
    orderRef: order.id,
    amountPoisha: input.amountPoisha,
    attemptId,
    gatewayTransactionId: normalizedTrx,
    idempotencyKey: `rocket-trx:${order.id}:${normalizedTrx}`,
  });
  const attemptRow = await prisma.paymentAttempt.findUnique({
    where: { id: attempt.attemptId },
    select: { paymentId: true },
  });
  if (!attemptRow) {
    return { ok: false, code: "ATTEMPT_LOOKUP_FAILED", error: "Payment attempt could not be recorded." };
  }

  const submissionId = `sbx-trx-${hash8(`rocket:${normalizedTrx}:${order.id}`)}`;
  try {
    const submission = await createManualTrxRow({
      id: submissionId,
      orderRef: order.id,
      method: "rocket",
      trxId: input.trxId,
      senderPhone: input.senderPhone.trim(),
      amountPoisha: input.amountPoisha,
      paymentId: attemptRow.paymentId,
    });
    return { ok: true, submission, paymentAttemptId: attempt.attemptId, state: "pending_verification" };
  } catch (err) {
    // UNIQUE(method, trxId) backstop: a concurrent submission won
    // the race. If the winner is THIS pair (same payment link — a
    // retried request whose first attempt actually completed), the
    // attempt is the winner's live claim and must NOT be touched;
    // only a genuinely orphaned attempt (the TrxID was claimed by a
    // different submission) is failed so it cannot be mistaken for
    // a live claim.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      const winner = await findManualTrxByMethodAndTrxDb("rocket", input.trxId).catch(() => null);
      if (!winner || winner.paymentId !== attemptRow.paymentId) {
        await prismaLivePaymentStore.applyStatus(attempt.attemptId, "FAILED").catch(() => null);
      }
      return { ok: false, code: "DUPLICATE_TRX", error: "Duplicate TrxID for this method." };
    }
    if (err instanceof SandboxOrderNotFoundError) {
      return { ok: false, code: "ORDER_NOT_FOUND", error: "Order not found for this submission." };
    }
    throw err;
  }
}
