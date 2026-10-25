/**
 * POST /api/v1/public/account/orders/[id]/reorder — buy-again resolution
 * (plan 17 batch O2). The logged-in customer asks to reorder one of
 * their OWN past orders: every line is re-resolved against the live
 * catalog (src/customer-auth/reorder) and the response is a CART
 * PAYLOAD plus a per-item report — items that can be re-added at
 * today's price and stock, and items skipped with a bilingual reason.
 *
 * This endpoint creates NO order and reserves NO stock. The client
 * merges the payload into the guest cart and the actual order still
 * goes through checkout -> POST /api/v1/public/orders, which
 * re-validates everything. An id belonging to another customer
 * returns the same 404 as a non-existent id (no enumeration).
 */
import { NextResponse } from "next/server";
import { errorResponse, methodNotAllowed, requireCustomer, unauthorized } from "@/customer-auth/http";
import { resolveReorder } from "@/customer-auth/reorder";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();
  const { id } = await params;

  const resolution = await resolveReorder(customer.id, id);
  if (resolution === null) {
    return errorResponse("ORDER_NOT_FOUND", "অর্ডারটি পাওয়া যায়নি। / Order not found.", 404);
  }

  return NextResponse.json({
    data: {
      orderNo: resolution.orderNo,
      items: resolution.items,
      skipped: resolution.skipped,
    },
    meta: { db: "PRISMA" },
  });
}

export function GET() {
  return methodNotAllowed();
}
