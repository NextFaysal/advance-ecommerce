/**
 * POST /api/v1/admin/orders/[id]/pickup-otp/resend — staff re-issue a
 * pickup OTP (ADV-19 remainder), guarded by orders.edit. Used when
 * the original code expired (24h TTL), was exhausted (5 attempts), or
 * the SMS never arrived. Re-issuing SUPERSEDES the old code — only
 * the newest code can verify.
 *
 * Honest delivery state: the response says sms: "queued" when the
 * job reached Redis and "not-queued" with the reason when it did not
 * (e.g. no REDIS_URL). Queued is never reported as "sent" — actual
 * delivery needs the worker + a live SMS provider.
 */
import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { writeAudit } from "@/lib/audit";
import { isPickupOrder, issuePickupOtp, sendPickupOtpSms } from "@/orders/pickup-otp";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("orders.edit");
  if (!auth.ok) return NextResponse.json(guardError(auth), { status: auth.status });

  if (!(await isPickupOrder(params.id))) {
    return NextResponse.json(
      {
        error: {
          code: "NOT_A_PICKUP_ORDER",
          message: "এই অর্ডারটি পিকআপ অর্ডার নয়। / This order has no pickup point, so no pickup OTP applies.",
        },
      },
      { status: 400 },
    );
  }

  let code: string;
  try {
    ({ code } = await issuePickupOtp(params.id));
  } catch {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Order not found." } },
      { status: 404 },
    );
  }
  const sms = await sendPickupOtpSms(params.id, code);
  await writeAudit({
    actorId: auth.userId,
    action: "orders.pickup_otp_resend",
    entityType: "Order",
    entityId: params.id,
    afterJson: { smsEnqueued: sms.enqueued },
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });

  return NextResponse.json({
    data: { issued: true, sms: sms.enqueued ? "queued" : "not-queued" },
    meta: {
      source: "pickup-otp",
      ...(sms.enqueued ? {} : { smsReason: sms.reason }),
      note: "queued means the SMS job is in Redis; delivery happens when the worker runs and a live SMS provider is configured",
    },
  });
}
