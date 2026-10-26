/**
 * bKash LIVE gateway refund execution — ADV-4 (doc 22).
 *
 * POST /api/v1/admin/payments/bkash/refund   (payments.refund)
 * Body: { paymentAttemptId, amountPoisha, reason }
 *
 * WHY THIS ROUTE EXISTS: the refund workbench (src/orders/refunds.ts)
 * is BY DESIGN a staff-records system — it records payouts a human
 * sent manually (bKash personal send, bank, cash) and never moves
 * money itself; it has no gateway-execution seam. Money that arrived
 * through the live bKash gateway can instead be reversed through
 * bKash's own refund API, which is what this route executes:
 *
 *   gateway.refund() -> bKash refund call -> on bKash "Completed" the
 *   gateway itself records the Refund row (status COMPLETED, the
 *   gateway-path convention) and recomputes the order's payment
 *   status through markOrderPayment. A bKash refund that does not
 *   confirm Completed records NOTHING and this route says so (502) —
 *   staff then reconcile in the merchant panel instead of the ledger
 *   pretending money came back.
 *
 * The Refund rows written here appear in the workbench list for the
 * order like any gateway-path refund. No credential value is ever
 * returned. Unconfigured (mode not live / credentials incomplete) is
 * 422 with the missing Settings field names — never a fake success.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminPermission } from "@/integrations/sandbox/admin-auth";
import { BkashProviderError } from "@/integrations/bkash/client";
import { buildLiveBkashGateway, diagnoseBkash } from "@/integrations/bkash/resolver";
import { bkashSettingsReader } from "@/payments/initiate";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  paymentAttemptId: z.string().min(1),
  amountPoisha: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
});

export async function POST(req: Request) {
  const guard = await requireAdminPermission("payments.refund");
  if (!guard.ok) {
    return NextResponse.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.httpStatus },
    );
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "paymentAttemptId, a positive integer amountPoisha, and a reason are required." } },
      { status: 400 },
    );
  }
  const gateway = await buildLiveBkashGateway(bkashSettingsReader);
  if (gateway === null) {
    const diagnosis = await diagnoseBkash(bkashSettingsReader);
    const problems: string[] = [];
    if (diagnosis.mode !== "live") problems.push('payment.bkash.mode is not "live"');
    if (!diagnosis.enabled) problems.push('payment.bkash.enabled is not "true"');
    if (diagnosis.missingFields.length > 0) {
      problems.push(`missing credential field(s): ${diagnosis.missingFields.map((f) => `payment.bkash.${f}`).join(", ")}`);
    }
    return NextResponse.json(
      { error: { code: "BKASH_NOT_CONFIGURED", message: `Live bKash is not configured — ${problems.join("; ") || "unknown configuration gap"}.` } },
      { status: 422 },
    );
  }
  try {
    const result = await gateway.refund({
      paymentId: parsed.data.paymentAttemptId,
      amountPoisha: parsed.data.amountPoisha,
      reason: parsed.data.reason,
      // Each admin POST is an intentional, distinct refund operation
      // (partial refunds are legitimate); the key names it as such.
      idempotencyKey: `bkash-refund:${parsed.data.paymentAttemptId}:${parsed.data.amountPoisha}:${Date.now()}`,
    });
    return NextResponse.json({
      data: { status: result.status, refundedPoisha: result.refundedPoisha },
      meta: { provider: "bkash", live: true },
    });
  } catch (err) {
    if (err instanceof BkashProviderError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: 502 },
      );
    }
    const message = err instanceof Error ? err.message : "Refund failed.";
    if (message.includes("not found")) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message } }, { status: 404 });
    }
    if (message.includes("exceeds") || message.includes("unpaid") || message.includes("missing its executed")) {
      return NextResponse.json({ error: { code: "REFUND_NOT_POSSIBLE", message } }, { status: 422 });
    }
    return NextResponse.json({ error: { code: "REFUND_FAILED", message } }, { status: 500 });
  }
}
