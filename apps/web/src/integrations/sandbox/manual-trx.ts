// Manual mobile-banking TrxID flow — Agent 9, Step 19/20.
// Customer submits (method, TrxID, sender phone, claimed amount) from the
// checkout side; an admin with payments.verify_manual approves or rejects
// here. Hard rules, enforced in this module and not only in the UI:
//  1. The same (method, normalised TrxID) can never be approved twice.
//     A second submission with an already-approved (method, TrxID) is a
//     duplicate and is rejected at creation, not at review time.
//  2. A submission that is already approved/rejected cannot be reviewed
//     again — review is a one-way, one-time action.
//  3. Every review requires a non-empty reason, and is audited by the
//     route caller with actor, before/after status and the reason.
//     The TrxID itself is never written to an audit record beyond the
//     submission id (audit.ts sanitises token-like keys, but callers must
//     not pass the full TrxID either).
// Persistence: DB-backed since 2026-10-24 (./db-store.ts). Rule 1 is
// enforced by the UNIQUE index on manual_trx_submissions(method, trxId)
// — trxIds are stored normalised (trim + uppercase), so the DB
// constraint is exactly the duplicate rule; the checks below remain as
// the friendly first pass and defence in depth.
// Rocket extension (ADV-4 remainder): submissions created by
// src/payments/rocket-manual.ts carry paymentId (a linked
// PaymentAttempt). Reviewing one flips that attempt through
// applyAttemptStatus — approval only at the exact claimed amount,
// rejection closes the attempt FAILED — so the pair never disagrees
// and the money is counted exactly once (on the Payment).
import { z } from "zod";
import type { DuplicateTrxCheck, ManualTrxSubmission } from "../payment";
import { markOrderPayment } from "../../orders/repository";
import { normalizeTrxId } from "./store";
import {
  SandboxOrderNotFoundError,
  applyAttemptStatus,
  createManualTrxRow,
  findApprovedManualTrx,
  findAttemptByPaymentId,
  findManualTrxByMethodAndTrxDb,
  getManualTrxById,
  listManualTrxDb,
  updateManualTrxReview,
} from "./db-store";
import { hash8 } from "./deterministic";

export const manualTrxCreateSchema = z.object({
  orderId: z.string().min(1),
  method: z.enum(["bkash", "nagad", "rocket", "upay"]),
  trxId: z.string().min(6).max(32),
  senderPhone: z.string().min(11).max(15),
  amountPoisha: z.number().int().positive(),
});

export const manualTrxReviewSchema = z.object({
  submissionId: z.string().min(1),
  action: z.enum(["approve", "reject"]),
  reason: z.string().min(3).max(500),
});

export type ManualTrxReviewInput = z.infer<typeof manualTrxReviewSchema>;

export async function checkDuplicateTrx(
  method: ManualTrxSubmission["method"],
  trxId: string,
): Promise<DuplicateTrxCheck> {
  const existing = await findManualTrxByMethodAndTrxDb(method, trxId);
  return {
    method,
    trxId: normalizeTrxId(trxId),
    existingSubmissionId: existing?.id ?? null,
    isDuplicate: existing !== null,
  };
}

export type CreateManualTrxResult =
  | { ok: true; submission: ManualTrxSubmission }
  | { ok: false; error: string; duplicate: DuplicateTrxCheck };

export async function createManualTrxSubmission(
  raw: unknown,
  idempotencyKey: string,
): Promise<CreateManualTrxResult> {
  const parsed = manualTrxCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid manual TrxID submission.",
      duplicate: { method: "bkash", trxId: "", existingSubmissionId: null, isDuplicate: false },
    };
  }
  const duplicate = await checkDuplicateTrx(parsed.data.method, parsed.data.trxId);
  if (duplicate.isDuplicate) {
    return { ok: false, error: "Duplicate TrxID for this method.", duplicate };
  }
  const id = `sbx-trx-${hash8(`${parsed.data.method}:${normalizeTrxId(parsed.data.trxId)}:${idempotencyKey}`)}`;
  try {
    const submission = await createManualTrxRow({
      id,
      orderRef: parsed.data.orderId,
      method: parsed.data.method,
      trxId: parsed.data.trxId,
      senderPhone: parsed.data.senderPhone,
      amountPoisha: parsed.data.amountPoisha,
    });
    return { ok: true, submission };
  } catch (err) {
    if (err instanceof SandboxOrderNotFoundError) {
      return {
        ok: false,
        error: "Order not found for this submission.",
        duplicate: { method: parsed.data.method, trxId: normalizeTrxId(parsed.data.trxId), existingSubmissionId: null, isDuplicate: false },
      };
    }
    // UNIQUE(method, trxId) backstop: a concurrent create won the race.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      const winner = await checkDuplicateTrx(parsed.data.method, parsed.data.trxId);
      return { ok: false, error: "Duplicate TrxID for this method.", duplicate: winner };
    }
    throw err;
  }
}

export type ReviewManualTrxResult =
  | { ok: true; submission: ManualTrxSubmission; paymentStatus: "PAID" | "FAILED" }
  | { ok: false; error: string };

/**
 * Approve or reject a pending submission. Approving a (method, TrxID) that
 * another submission already approved is refused even if the DB somehow
 * holds two pending rows for it (defence in depth for rule 1).
 */
export async function reviewManualTrx(
  input: ManualTrxReviewInput,
  reviewerId: string,
): Promise<ReviewManualTrxResult> {
  const submission = await getManualTrxById(input.submissionId);
  if (!submission) return { ok: false, error: "Submission not found." };
  if (submission.status !== "pending") {
    return { ok: false, error: `Submission already ${submission.status}; it cannot be reviewed again.` };
  }
  // Rocket (ADV-4 remainder): a submission created by
  // src/payments/rocket-manual.ts is LINKED to a PaymentAttempt
  // (submission.paymentId set). Approving it must flip that attempt
  // through the shared funnel — and ONLY at the exact claimed
  // amount. The pair is created with identical amounts; a mismatch
  // means the rows drifted (manual DB edit, partial legacy data) and
  // approval is refused rather than confirming a different amount
  // than the one staff are looking at. Unlinked submissions (the
  // classic bKash/Nagad manual flow, or a Rocket submission created
  // before the link existed) keep the original behaviour exactly:
  // the APPROVED row itself is the money fact.
  const linkedAttempt =
    submission.method === "rocket" && submission.paymentId
      ? await findAttemptByPaymentId(submission.paymentId)
      : null;
  if (input.action === "approve") {
    const approvedElsewhere = await findApprovedManualTrx(submission.method, submission.trxId, submission.id);
    if (approvedElsewhere) {
      return { ok: false, error: "This TrxID has already been approved for another submission." };
    }
    if (submission.method === "rocket" && submission.paymentId) {
      if (!linkedAttempt) {
        return {
          ok: false,
          error: "Rocket submission is linked to a payment that has no attempt — cannot confirm. Investigate before approving.",
        };
      }
      if (linkedAttempt.amountPoisha !== submission.amountPoisha) {
        return {
          ok: false,
          error:
            `Rocket attempt amount (${linkedAttempt.amountPoisha} poisha) does not equal the claimed amount ` +
            `(${submission.amountPoisha} poisha) — refusing to confirm a different amount than claimed.`,
        };
      }
    }
    const updated = await updateManualTrxReview(submission.id, "approved", reviewerId, input.reason);
    if (linkedAttempt) {
      // The confirmation write: the shared funnel, exact amount.
      // markOrderPayment below re-derives the order status from
      // persisted rows; the money is counted once, on the Payment
      // (money-math aggregates skip payment-linked submissions).
      await applyAttemptStatus(linkedAttempt.attemptId, "PAID", submission.amountPoisha);
    }
    // Order-paid funnel: the APPROVED submission row above is the
    // persisted payment fact; the funnel recomputes the linked
    // Order's payment status from persisted rows (an approved amount
    // below the order total lands as PARTIAL, never a blind PAID) and
    // publishes payment.succeeded on the transition into PAID. The
    // "PAID" returned below stays the review-level claim the route
    // audits/returns; the ORDER's status is whatever the funnel
    // derived.
    await markOrderPayment(updated.orderId, {
      paymentStatus: "PAID",
      source: "manual_trx_review",
      reference: updated.id,
    });
    return { ok: true, submission: updated, paymentStatus: "PAID" };
  }
  const updated = await updateManualTrxReview(submission.id, "rejected", reviewerId, input.reason);
  if (linkedAttempt && linkedAttempt.status === "UNPAID") {
    // Rejecting the claim closes its attempt too, so the pair never
    // disagrees (submission rejected / attempt dangling UNPAID).
    await applyAttemptStatus(linkedAttempt.attemptId, "FAILED");
  }
  return { ok: true, submission: updated, paymentStatus: "FAILED" };
}

export async function listManualTrx(
  status?: ManualTrxSubmission["status"],
): Promise<ManualTrxSubmission[]> {
  return listManualTrxDb(status);
}
