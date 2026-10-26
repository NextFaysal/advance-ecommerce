/**
 * Upay browser callbacks — ADV-4 remainder (doc 22).
 *
 * GET|POST /api/v1/public/payments/upay/callback?result=success|fail|cancel
 *
 * Mirrors the SSLCommerz callback contract exactly: the browser
 * parameters are NEVER trusted — on result=success the handler
 * resolves the persisted attempt by our invoice id (the attempt id,
 * carried as invoice_id / tran_id) and confirms through the
 * gateway's own verify(), which queries Upay server-side and checks
 * invoice + status + EXACT amount against the attempt. On
 * fail/cancel a still-UNPAID attempt is resolved FAILED through the
 * shared store. Every outcome ends in a 303 redirect to /track,
 * where the customer sees the order's real persisted payment state.
 *
 * ⚠️ The callback parameter spellings follow the SSLCommerz pattern
 * + the grounded Upay facts (invoice-keyed); like every Upay wire
 * detail they are UNVERIFIED against Upay's official merchant API
 * document — see src/integrations/upay/provider-http.ts. The
 * verify() confirmation rule is what protects the money either way:
 * a callback whose parameters do not resolve to a server-side
 * gateway record confirms nothing.
 */
import { NextResponse } from "next/server";
import { buildConfiguredPaymentGatewayFromSettings } from "@/payments/live-gateways";
import { prismaLivePaymentStore } from "@/payments/live-store";
import { UpayError } from "@/integrations/upay";

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
  const invoiceId = params.get("invoice_id") ?? params.get("tran_id") ?? params.get("invoiceId");
  if (!invoiceId) return trackRedirect(req, "failed");

  const attempt = await prismaLivePaymentStore.findAttemptById(invoiceId).catch(() => null);
  if (!attempt || attempt.method !== "upay") return trackRedirect(req, "failed");
  if (
    attempt.status === "PAID" ||
    attempt.status === "PARTIALLY_REFUNDED" ||
    attempt.status === "REFUNDED"
  ) {
    return trackRedirect(req, "success");
  }

  if (result === "success") {
    const gateway = await buildConfiguredPaymentGatewayFromSettings("upay").catch(() => null);
    if (!gateway) return trackRedirect(req, "failed");
    try {
      const verified = await gateway.verify({
        paymentAttemptId: attempt.attemptId,
        gatewayTransactionId: params.get("trx_id") ?? attempt.attemptId,
        idempotencyKey: `upay-callback:${attempt.attemptId}`,
      });
      return trackRedirect(req, verified.status === "PAID" ? "success" : "failed");
    } catch (error) {
      // A definitive provider verdict (invoice/amount mismatch)
      // reads as failed; a transient gateway/network problem reads
      // as pending — the order itself stays UNPAID and the IPN can
      // still confirm it.
      if (error instanceof UpayError && (error.code === "NETWORK" || error.code.startsWith("HTTP_"))) {
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
