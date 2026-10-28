/**
 * POST /api/v1/public/orders/[orderNo]/amend — doc 34 §3.7 (wave L8).
 *
 * The one-click funnel offer accept. Body: { token, phone,
 * stepClaim: { stepId } } — the signed funnel continuation token,
 * the customer's phone (re-proof of order ownership against the
 * order row), and WHICH step's offer is being accepted. Everything
 * else — the offer, its discount rule, the price — is read
 * server-side from the funnel + the live catalog by
 * src/funnels/amend.ts; the client can claim nothing about money.
 *
 * Money moves only inside that service: the order-edit service
 * appends the line to the SAME order, or (when it refuses) a held
 * second order is created for staff merge. See amend.ts for the
 * full guard list.
 *
 * Double-accept discipline mirrors checkout's two layers: this
 * route holds an in-process claim per (order, step) while an
 * accept runs (released on failure, kept on success), and the
 * service's durable marker OrderNote answers replays — a refresh
 * or double-tap can never add the line twice.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { InMemoryIdempotencyStore } from "@/checkout/idempotency";
import { checkRateLimit } from "@/lib/rate-limit";
import { VISITOR_COOKIE } from "@/marketing/experiments";
import { acceptFunnelOffer } from "@/funnels/amend";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    token: z.string().min(1).max(1024),
    phone: z.string().min(1).max(32),
    stepClaim: z.object({ stepId: z.string().min(1).max(128) }).strict(),
  })
  .strict();

const claimStore = new InMemoryIdempotencyStore();

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** The durable replay answer, when the marker note already exists. */
async function markerOutcome(orderNo: string, stepId: string) {
  const order = await prisma.order.findFirst({
    where: { orderNo, deletedAt: null },
    select: { id: true, totalPoisha: true },
  });
  if (!order) return null;
  const marker = await prisma.orderNote.findFirst({
    where: { orderId: order.id, text: { contains: `[funnel-accept:${stepId}]` } },
    select: { text: true },
  });
  if (!marker) return null;
  const m = /fallbackOrderNo=([A-Za-z0-9-]+)/.exec(marker.text);
  return {
    path: "already_applied" as const,
    orderNo,
    totalPoisha: order.totalPoisha,
    fallbackOrderNo: m ? m[1] : null,
  };
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", "অনুরোধটি সঠিক নয়। / The request is not valid.", 400);
  }
  const { token, phone, stepClaim } = parsed.data;
  const orderNo = params.id;

  // The phone is an ownership proof — guessing it must be expensive
  // (same posture as the gift-card surface on the orders route).
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
  const limit = await checkRateLimit(`funnel-amend:${ip}:${orderNo}`, 10, 60 * 60 * 1000);
  if (!limit.allowed) {
    return errorResponse(
      "RATE_LIMITED",
      "অনেকবার চেষ্টা হয়েছে — কিছুক্ষণ পরে আবার চেষ্টা করুন। / Too many attempts — please try again later.",
      429,
    );
  }

  const claimKey = `funnel-amend:${orderNo}:${stepClaim.stepId}`;
  if (!claimStore.claim(claimKey)) {
    // A twin request is in flight or already completed. If the
    // durable marker exists, answer with its outcome; otherwise the
    // first attempt is still running — a retry in a moment lands on
    // the marker.
    const replay = await markerOutcome(orderNo, stepClaim.stepId).catch(() => null);
    if (replay) {
      return NextResponse.json({ data: replay, meta: { source: "funnel-amend", replay: true } });
    }
    return errorResponse(
      "ACCEPT_IN_PROGRESS",
      "অফারটি প্রক্রিয়া করা হচ্ছে — এক মুহূর্ত পরে আবার চেষ্টা করুন। / The offer is being processed — please try again in a moment.",
      409,
    );
  }

  try {
    const visitorId = (await cookies()).get(VISITOR_COOKIE)?.value ?? null;
    const result = await acceptFunnelOffer({
      orderNo,
      token,
      phone,
      stepId: stepClaim.stepId,
      visitorId,
      ip,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    if (!result.ok) {
      claimStore.release(claimKey); // no money moved — a corrected retry may proceed
      return errorResponse(result.code, `${result.messageBn} / ${result.messageEn}`, result.httpStatus);
    }
    return NextResponse.json({
      data: {
        path: result.path,
        orderNo: result.orderNo,
        totalPoisha: result.totalPoisha,
        fallbackOrderNo: result.fallbackOrderNo,
        acceptStepId: result.acceptStepId,
        funnelSlug: result.funnelSlug,
      },
      meta: { source: "funnel-amend" },
    });
  } catch (e) {
    claimStore.release(claimKey);
    throw e;
  }
}
