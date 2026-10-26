/**
 * bKash customer callback — ADV-4 (doc 22).
 *
 * GET /api/v1/public/payments/bkash/callback?paymentID=…&status=success|failure|cancel
 *
 * bKash redirects the customer's BROWSER here after the hosted
 * checkout (the callbackURL handed over at create-payment time). This
 * route never trusts the `status` param as proof of payment:
 *
 *  - status=success + a known paymentID -> the LIVE gateway's
 *    verify() executes the payment server-to-server and accepts only
 *    bKash's own "Completed" + exact amount match; confirmation then
 *    flows through the EXISTING funnel (applyAttemptStatus +
 *    markOrderPayment — the same two writes the sandbox verify and
 *    the verified webhook perform). No parallel state machine.
 *  - status=failure / cancel -> an UNPAID attempt is marked FAILED
 *    honestly; the customer is told it did not go through.
 *  - unknown paymentID / missing params / gateway no longer
 *    configured -> no state changes; the customer lands on /track,
 *    where the order shows its true (unpaid) state.
 *
 * Every outcome ends in a redirect to /track with a coarse
 * ?payment= hint for the page to message on; no provider detail,
 * amount, or identifier is exposed in the URL beyond that hint.
 */
import { NextResponse } from "next/server";
import { buildLiveBkashGateway } from "@/integrations/bkash/resolver";
import { findBkashAttemptByPaymentId } from "@/integrations/bkash/store";
import { applyAttemptStatus } from "@/integrations/sandbox/db-store";
import { bkashSettingsReader } from "@/payments/initiate";

export const dynamic = "force-dynamic";

function appBase(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  return new URL(req.url).origin;
}

function backToTrack(req: Request, hint: string) {
  return NextResponse.redirect(`${appBase(req)}/track?payment=${hint}`);
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const paymentID = params.get("paymentID");
  const status = (params.get("status") ?? "").toLowerCase();
  if (!paymentID) return backToTrack(req, "unknown");

  const attempt = await findBkashAttemptByPaymentId(paymentID).catch(() => null);
  if (!attempt) return backToTrack(req, "unknown");

  if (status === "success") {
    const gateway = await buildLiveBkashGateway(bkashSettingsReader).catch(() => null);
    if (gateway === null) {
      // Credentials/mode changed after initiation: do NOT improvise a
      // confirmation path — staff reconcile from the bKash panel and
      // the attempt stays in its true state.
      return backToTrack(req, "failed");
    }
    try {
      const result = await gateway.verify({
        paymentAttemptId: attempt.attemptId,
        gatewayTransactionId: paymentID,
        idempotencyKey: `bkash-callback:${paymentID}`,
      });
      return backToTrack(req, result.status === "PAID" ? "success" : "failed");
    } catch {
      // Includes AMOUNT_MISMATCH: verify() deliberately left the
      // attempt UNPAID for staff reconciliation; the customer is told
      // the payment did not complete here, never that it succeeded.
      return backToTrack(req, "failed");
    }
  }

  // failure / cancel (or any unexpected status value): mark an
  // unresolved attempt FAILED so the books match what the customer
  // experienced; a PAID attempt is never downgraded by a stray hit.
  if (attempt.status === "UNPAID") {
    await applyAttemptStatus(attempt.attemptId, "FAILED").catch(() => null);
  }
  return backToTrack(req, status === "cancel" ? "cancelled" : "failed");
}
