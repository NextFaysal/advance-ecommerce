import { NextResponse } from "next/server";
import { prisma } from "@advance-ecommerce/db";
import { checkRateLimit } from "@/lib/redis";
import { sendOrderOtp } from "@/checkout/otp";

function maskPhone(phone: string): string {
  if (phone.length <= 4) return phone;
  return phone.slice(0, 4) + "*".repeat(phone.length - 7) + phone.slice(-3);
}

export async function POST(
  _req: Request,
  { params }: { params: { orderNo: string } },
) {
  const orderNo = params.orderNo;
  if (!orderNo) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Order number required." } },
      { status: 400 },
    );
  }

  // Rate limit: 1 OTP request every 45 seconds per order
  const rateLimit = await checkRateLimit(`otp:send:${orderNo}`, 1, 45);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: {
          code: "TOO_MANY_REQUESTS",
          message: `অনুগ্রহ করে ${rateLimit.resetSeconds} সেকেন্ড অপেক্ষা করে আবার চেষ্টা করুন। / Please wait ${rateLimit.resetSeconds}s before requesting a new OTP.`,
        },
      },
      { status: 429 },
    );
  }

  try {
    const order = await prisma.order.findUnique({
      where: { orderNo },
      select: { customerPhone: true, status: true },
    });

    if (!order) {
      return NextResponse.json(
        { error: { code: "ORDER_NOT_FOUND", message: "অর্ডারটি পাওয়া যায়নি। / Order not found." } },
        { status: 404 },
      );
    }

    const result = await sendOrderOtp(orderNo, order.customerPhone);
    return NextResponse.json({
      data: {
        ok: true,
        expiresSeconds: result.expiresSeconds,
        phoneMasked: maskPhone(order.customerPhone),
      },
    });
  } catch (err) {
    console.error(`[OTP Send Error] order ${orderNo}:`, err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "ওটিপি পাঠাতে সমস্যা হয়েছে। / Failed to send OTP." } },
      { status: 500 },
    );
  }
}
