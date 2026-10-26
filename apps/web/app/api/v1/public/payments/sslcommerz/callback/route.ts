/**
 * SSLCommerz browser callbacks — ADV-4 (doc 22).
 *
 * GET|POST /api/v1/public/payments/sslcommerz/callback?result=success|fail|cancel
 *
 * SSLCommerz redirects the customer's browser here after checkout
 * (form-encoded POST; GET accepted for the flows that use it). The
 * POST body is NEVER trusted: on result=success the handler takes
 * only the val_id from it and confirms through the gateway's own
 * verify() — the validation API record (status + tran_id + amount)
 * is the sole evidence, checked against the persisted attempt whose
 * id IS the tran_id. On fail/cancel a still-UNPAID attempt is
 * resolved FAILED through the shared store. Every outcome ends in a
 * 303 redirect to /track, where the customer sees the order's real
 * persisted payment state.
 */
import { NextResponse } from "next/server";
import { buildConfiguredPaymentGatewayFromSettings } from "@/payments/live-gateways";
import { prismaLivePaymentStore } from "@/payments/live-store";
import { SslCommerzError } from "@/integrations/sslcommerz";

export const dynamic = "force-dynamic";

function trackRedirect(req: Request, outcome: "success" | "failed" | "cancelled" | "pending") {
  const url = new URL("/track", req.url);
  url.searchParams.set("payment", outcome);
  return NextResponse.redirect(url, { status: 303 });
}

async function readParams(req: Request): Promise<URLSearchParams> {
  const params = new URLSearchParams(new URL(req.url).search);
  if (req.method === "POST") {
    const text = await req.text().catch(() => "");
    for (const [key, value] of new URLSearchParams(text)) {
      if (!params.has(key)) params.set(key, value);
    }
  }
  return params;
}

async function handle(req: Request) {
  const params = await readParams(req);
  const result = params.get("result") ?? "fail";
  const tranId = params.get("tran_id");
  if (!tranId) return trackRedirect(req, "failed");

  const attempt = await prismaLivePaymentStore.findAttemptById(tranId).catch(() => null);
  if (!attempt || attempt.method !== "sslcommerz") return trackRedirect(req, "failed");
  if (
    attempt.status === "PAID" ||
    attempt.status === "PARTIALLY_REFUNDED" ||
    attempt.status === "REFUNDED"
  ) {
    return trackRedirect(req, "success");
  }

  if (result === "success") {
    const valId = params.get("val_id");
    if (!valId) return trackRedirect(req, "failed");
    const gateway = await buildConfiguredPaymentGatewayFromSettings("sslcommerz").catch(() => null);
    if (!gateway) return trackRedirect(req, "failed");
    try {
      const verified = await gateway.verify({
        paymentAttemptId: attempt.attemptId,
        gatewayTransactionId: valId,
        idempotencyKey: `ssl-callback:${attempt.attemptId}:${valId}`,
      });
      return trackRedirect(req, verified.status === "PAID" ? "success" : "failed");
    } catch (error) {
      // A definitive provider verdict (amount/tran mismatch) reads as
      // failed; a transient gateway/network problem reads as pending —
      // the order itself stays UNPAID and the IPN can still confirm it.
      if (error instanceof SslCommerzError && (error.code === "NETWORK" || error.code.startsWith("HTTP_"))) {
        return trackRedirect(req, "pending");
      }
      return trackRedirect(req, "failed");
    }
  }

  // fail / cancel: resolve the still-open attempt, then send the
  // customer to the tracker with the honest outcome.
  if (attempt.status === "UNPAID") {
    await prismaLivePaymentStore.applyStatus(attempt.attemptId, "FAILED").catch(() => null);
  }
  return trackRedirect(req, result === "cancel" ? "cancelled" : "failed");
}

export const GET = handle;
export const POST = handle;
