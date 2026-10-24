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
// The DB version must enforce rule 1 with a UNIQUE index on
// manual_trx_submissions(method, trxId) — this in-memory check is the
// sandbox equivalent, not a concurrency-safe substitute.
import { z } from "zod";
import type { DuplicateTrxCheck, ManualTrxSubmission } from "../payment";
import { findManualTrxByMethodAndTrx, normalizeTrxId, sandboxStore } from "./store";
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

export function checkDuplicateTrx(
  method: ManualTrxSubmission["method"],
  trxId: string,
): DuplicateTrxCheck {
  const existing = findManualTrxByMethodAndTrx(method, trxId);
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

export function createManualTrxSubmission(
  raw: unknown,
  idempotencyKey: string,
): CreateManualTrxResult {
  const parsed = manualTrxCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid manual TrxID submission.",
      duplicate: { method: "bkash", trxId: "", existingSubmissionId: null, isDuplicate: false },
    };
  }
  const duplicate = checkDuplicateTrx(parsed.data.method, parsed.data.trxId);
  if (duplicate.isDuplicate) {
    return { ok: false, error: "Duplicate TrxID for this method.", duplicate };
  }
  const submission: ManualTrxSubmission = {
    id: `sbx-trx-${hash8(`${parsed.data.method}:${normalizeTrxId(parsed.data.trxId)}:${idempotencyKey}`)}`,
    orderId: parsed.data.orderId,
    method: parsed.data.method,
    trxId: normalizeTrxId(parsed.data.trxId),
    senderPhone: parsed.data.senderPhone,
    amountPoisha: parsed.data.amountPoisha,
    status: "pending",
    reviewedById: null,
    reviewNote: null,
    submittedAt: new Date().toISOString(),
  };
  sandboxStore.manualTrx.set(submission.id, submission);
  return { ok: true, submission };
}

export type ReviewManualTrxResult =
  | { ok: true; submission: ManualTrxSubmission; paymentStatus: "PAID" | "FAILED" }
  | { ok: false; error: string };

/**
 * Approve or reject a pending submission. Approving a (method, TrxID) that
 * another submission already approved is refused even if the store somehow
 * holds two pending rows for it (defence in depth for rule 1).
 */
export function reviewManualTrx(input: ManualTrxReviewInput, reviewerId: string): ReviewManualTrxResult {
  const submission = sandboxStore.manualTrx.get(input.submissionId);
  if (!submission) return { ok: false, error: "Submission not found." };
  if (submission.status !== "pending") {
    return { ok: false, error: `Submission already ${submission.status}; it cannot be reviewed again.` };
  }
  if (input.action === "approve") {
    for (const other of sandboxStore.manualTrx.values()) {
      if (
        other.id !== submission.id &&
        other.method === submission.method &&
        normalizeTrxId(other.trxId) === normalizeTrxId(submission.trxId) &&
        other.status === "approved"
      ) {
        return { ok: false, error: "This TrxID has already been approved for another submission." };
      }
    }
    submission.status = "approved";
    submission.reviewedById = reviewerId;
    submission.reviewNote = input.reason;
    return { ok: true, submission, paymentStatus: "PAID" };
  }
  submission.status = "rejected";
  submission.reviewedById = reviewerId;
  submission.reviewNote = input.reason;
  return { ok: true, submission, paymentStatus: "FAILED" };
}

export function listManualTrx(status?: ManualTrxSubmission["status"]): ManualTrxSubmission[] {
  const all = [...sandboxStore.manualTrx.values()];
  return status ? all.filter((s) => s.status === status) : all;
}
