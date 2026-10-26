/**
 * Nagad merchant callback — ADV-4 (doc 22).
 *
 * GET|POST /api/v1/public/payments/nagad/callback?payment_ref_id=…&status=…
 *
 * Nagad redirects the customer's browser to the merchantCallbackURL
 * (the returnUrl the initiation was created with) carrying
 * payment_ref_id. The `status` query parameter is NEVER trusted —
 * the handler resolves the attempt by the parked payment reference
 * and confirms through the gateway's verify(), which calls Nagad's
 * verify-payment API and checks status + orderId + amount against
 * the persisted attempt. Every outcome ends in a 303 redirect to
 * /track, where the customer sees the order's real persisted state.
 */
import { NextResponse } from "next/server";
import { buildConfiguredPaymentGatewayFromSettings } from "@/payments/live-gateways";
import { prismaLivePaymentStore } from "@/payments/live-store";
import { NagadError } from "@/integrations/nagad";

export const dynamic = "force-dynamic";

function trackRedirect(req: Request, outcome: "success" | "failed" | "pending") {
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
  const paymentRefId = params.get("payment_ref_id") ?? params.get("paymentRefId");
  if (!paymentRefId) return trackRedirect(req, "failed");

  const attempt = await prismaLivePaymentStore
    .findAttemptByResponseRef("nagad", paymentRefId)
    .catch(() => null);
  if (!attempt) return trackRedirect(req, "failed");
  if (
    attempt.status === "PAID" ||
    attempt.status === "PARTIALLY_REFUNDED" ||
    attempt.status === "REFUNDED"
  ) {
    return trackRedirect(req, "success");
  }

  const gateway = await buildConfiguredPaymentGatewayFromSettings("nagad").catch(() => null);
  if (!gateway) return trackRedirect(req, "failed");
  try {
    const verified = await gateway.verify({
      paymentAttemptId: attempt.attemptId,
      gatewayTransactionId: paymentRefId,
      idempotencyKey: `nagad-callback:${attempt.attemptId}:${paymentRefId}`,
    });
    return trackRedirect(req, verified.status === "PAID" ? "success" : "failed");
  } catch (error) {
    if (error instanceof NagadError && (error.code === "NETWORK" || error.code.startsWith("HTTP_"))) {
      return trackRedirect(req, "pending");
    }
    return trackRedirect(req, "failed");
  }
}

export const GET = handle;
export const POST = handle;
