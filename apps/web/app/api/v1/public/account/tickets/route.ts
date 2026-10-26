/**
 * /api/v1/public/account/tickets — the logged-in customer's support
 * tickets (ADV-16b). GET lists ONLY the caller's own tickets; POST
 * creates one (an optional orderId is verified against the caller's
 * own orders in the store — a foreign order is rejected, never
 * silently dropped). Auth: requireCustomer() (customer_session).
 */
import { NextResponse } from "next/server";
import { errorResponse, methodNotAllowed, requireCustomer, unauthorized } from "@/customer-auth/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { createTicketSchema } from "@/support/schema";
import {
  createTicket,
  listTicketsForCustomer,
  TicketOrderNotOwnedError,
} from "@/support/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();

  const tickets = await listTicketsForCustomer(customer.id);
  return NextResponse.json({
    data: { tickets },
    meta: { persistence: "database" },
  });
}

export async function POST(req: Request) {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();

  const limit = await checkRateLimit(`ticket-create:${customer.id}`, 5, 3_600_000);
  if (!limit.allowed) {
    return errorResponse(
      "RATE_LIMITED",
      "অনেকবার চেষ্টা করা হয়েছে — কিছুক্ষণ পর আবার চেষ্টা করুন।",
      429,
    );
  }

  const parsed = createTicketSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", "বিষয় ও বার্তা সঠিকভাবে লিখুন।", 400, parsed.error.issues);
  }

  try {
    const ticket = await createTicket(customer.id, parsed.data);
    return NextResponse.json(
      { data: { ticket }, meta: { persistence: "database" } },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof TicketOrderNotOwnedError) {
      return errorResponse(
        "ORDER_NOT_OWNED",
        "এই অর্ডারটি আপনার অ্যাকাউন্টের নয় — নিজের অর্ডার বেছে নিন।",
        400,
      );
    }
    throw error;
  }
}

export function PUT() {
  return methodNotAllowed();
}

export function DELETE() {
  return methodNotAllowed();
}
