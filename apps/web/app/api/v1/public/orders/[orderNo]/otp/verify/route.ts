import { NextResponse } from "next/server";
import { verifyOrderOtp } from "@/checkout/otp";

export async function POST(
  req: Request,
  { params }: { params: { orderNo: string } },
) {
  const orderNo = params.orderNo;
  if (!orderNo) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Order number required." } },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { code?: string };
  const code = body.code;
  if (!code) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "৬-সংখ্যার ওটিপি কোড দিন। / OTP code is required." } },
      { status: 400 },
    );
  }

  try {
    const result = await verifyOrderOtp(orderNo, code);
    if (!result.ok) {
      return NextResponse.json(
        { error: { code: result.error ?? "VERIFICATION_FAILED", message: result.message } },
        { status: 400 },
      );
    }

    return NextResponse.json({
      data: {
        ok: true,
        verified: true,
        message: result.message,
      },
    });
  } catch (err) {
    console.error(`[OTP Verify Error] order ${orderNo}:`, err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "যাচাইকরণে ত্রুটি হয়েছে। / Verification failed." } },
      { status: 500 },
    );
  }
}
