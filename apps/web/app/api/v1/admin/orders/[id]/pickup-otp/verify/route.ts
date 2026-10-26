/**
 * POST /api/v1/admin/orders/[id]/pickup-otp/verify — staff verify the
 * customer's pickup OTP at the counter (ADV-19 remainder), guarded by
 * orders.edit. Body: { code: "123456" }.
 *
 * A wrong/expired/exhausted code is a 400 PICKUP_OTP_INVALID with the
 * precise reason in error.details — the DELIVERED transition stays
 * blocked (applyOrderTransition's pickup gate) until a verify here
 * succeeds. Every attempt outcome is written to the audit log; the
 * code itself never is (it is a credential — only its fate is).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { writeAudit } from "@/lib/audit";
import { verifyPickupOtp } from "@/orders/pickup-otp";

export const dynamic = "force-dynamic";

const verifySchema = z.object({
  code: z.string().trim().regex(/^\d{4,6}$/, "Enter the 4–6 digit code."),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("orders.edit");
  if (!auth.ok) return NextResponse.json(guardError(auth), { status: auth.status });

  const parsed = verifySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "সঠিক OTP কোড দিন। / Enter a valid OTP code.",
          details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
      },
      { status: 400 },
    );
  }

  const result = await verifyPickupOtp(params.id, parsed.data.code);
  await writeAudit({
    actorId: auth.userId,
    action: "orders.pickup_otp_verify",
    entityType: "Order",
    entityId: params.id,
    afterJson: { verified: result.ok, ...(result.ok ? {} : { error: result.error }) },
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: {
          code: "PICKUP_OTP_INVALID",
          message:
            "OTP মেলেনি বা মেয়াদ শেষ — আবার চেষ্টা করুন অথবা নতুন কোড পাঠান। / The pickup OTP did not verify — try again or resend a new code.",
          details: result.error,
        },
      },
      { status: 400 },
    );
  }
  return NextResponse.json({ data: { verified: true }, meta: { source: "pickup-otp" } });
}
