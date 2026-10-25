/**
 * Customer self-service returns — /api/v1/public/account/orders/[id]/returns
 * (doc 17 batch O7, part 2).
 *
 * POST: a signed-in customer applies for a return on one of their OWN
 *       DELIVERED orders, within the Settings return window
 *       (orders.returns.window_days, default 7 — policy lives in
 *       src/orders/return-self-service.ts). The write itself is the
 *       RMA core's shared createReturn (src/orders/returns.ts) with
 *       source "customer" and actorLabel "customer:<id>" (the Return
 *       schema's documented convention). After a successful create
 *       the customer is notified via notifyReturnStatus (REQUESTED) —
 *       the SMS is QUEUED, not delivered, and meta says which.
 * GET:  the form feed for the same order — eligibility, the delivery
 *       date + window, and the returnable lines (quantities already
 *       claimed by earlier returns are subtracted server-side).
 *
 * Ownership is order.customerId === session customer, exactly like
 * the reorder route: another customer's order id returns the same
 * 404 as a non-existent one (no enumeration). Guests have NO online
 * return path by design — the account UI copy sends them to the
 * hotline instead.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, methodNotAllowed, requireCustomer, unauthorized } from "@/customer-auth/http";
import { createReturn } from "@/orders/returns";
import { checkCustomerReturnEligibility } from "@/orders/return-self-service";
import { notifyReturnStatus } from "@/orders/return-notify";

const createSchema = z.object({
  items: z
    .array(
      z.object({
        orderItemId: z.string().min(1),
        quantity: z.number().int().positive(),
        reason: z.string().trim().max(300).optional(),
      }),
    )
    .min(1),
  customerNote: z.string().trim().max(500).optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();
  const { id } = await params;

  const eligibility = await checkCustomerReturnEligibility(customer.id, id);
  if (!eligibility.ok) {
    if (eligibility.code === "NOT_FOUND") {
      return errorResponse("ORDER_NOT_FOUND", eligibility.message, 404);
    }
    return NextResponse.json({
      data: {
        eligible: false,
        code: eligibility.code,
        message: eligibility.message,
        windowDays: eligibility.windowDays,
        deliveredAt: eligibility.deliveredAt ?? null,
        lines: [],
      },
      meta: { db: "PRISMA" },
    });
  }
  return NextResponse.json({
    data: {
      eligible: true,
      orderId: eligibility.orderId,
      orderNo: eligibility.orderNo,
      deliveredAt: eligibility.deliveredAt,
      deliveredAtSource: eligibility.deliveredAtSource,
      windowDays: eligibility.windowDays,
      lines: eligibility.lines,
    },
    meta: { db: "PRISMA" },
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "INVALID_INPUT",
      "কোন পণ্য, কতটি করে ফেরত দিতে চান তা সঠিকভাবে দিন। / Choose the items and quantities to return.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }

  const eligibility = await checkCustomerReturnEligibility(customer.id, id);
  if (!eligibility.ok) {
    const status =
      eligibility.code === "NOT_FOUND" ? 404 : eligibility.code === "RETURN_WINDOW_EXPIRED" ? 422 : 409;
    return errorResponse(eligibility.code, eligibility.message, status);
  }

  // Claimed quantities can never exceed what is still returnable —
  // checked here for a clean 400; the core re-validates on write.
  const returnable = new Map(eligibility.lines.map((l) => [l.orderItemId, l.returnableQuantity]));
  for (const item of parsed.data.items) {
    const max = returnable.get(item.orderItemId);
    if (max === undefined) {
      return errorResponse(
        "INVALID_INPUT",
        "তালিকার একটি পণ্য এই অর্ডারের নয়। / One of the items does not belong to this order.",
        400,
      );
    }
    if (item.quantity > max) {
      return errorResponse(
        "INVALID_INPUT",
        `একটি পণ্যের ফেরতযোগ্য পরিমাণের বেশি চাওয়া হয়েছে (সর্বোচ্চ ${max}টি)। / Quantity exceeds the returnable amount (max ${max}).`,
        400,
      );
    }
  }

  let created: { returnId: string; status: string };
  try {
    created = await createReturn({
      orderId: id,
      items: parsed.data.items,
      source: "customer",
      actorLabel: `customer:${customer.id}`,
      customerNote: parsed.data.customerNote,
    });
  } catch (e) {
    return errorResponse(
      "RETURN_NOT_CREATED",
      `রিটার্নের আবেদন তৈরি করা যায়নি। / The return request could not be created. (${e instanceof Error ? e.message : "unknown error"})`,
      409,
    );
  }

  const notify = await notifyReturnStatus(created.returnId, "REQUESTED");
  return NextResponse.json(
    {
      data: { returnId: created.returnId, status: created.status, orderNo: eligibility.orderNo },
      // sms: "queued" means the notification job is in Redis — it is
      // NOT a delivered SMS (no worker/provider until the VPS).
      meta: { db: "PRISMA", sms: notify.sms },
    },
    { status: 201 },
  );
}

export function PUT() {
  return methodNotAllowed();
}
