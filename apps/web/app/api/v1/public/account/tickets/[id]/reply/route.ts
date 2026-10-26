/**
 * POST /api/v1/public/account/tickets/[id]/reply — the ticket owner
 * replies. The store re-checks ownership in the same flow (a foreign
 * ticket → 404) and moves the ticket back to OPEN, reopening it if
 * staff had closed it.
 */
import { NextResponse } from "next/server";
import { errorResponse, requireCustomer, unauthorized } from "@/customer-auth/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { ticketReplySchema } from "@/support/schema";
import { replyToTicketAsCustomer } from "@/support/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();

  const limit = await checkRateLimit(`ticket-reply:${customer.id}`, 30, 3_600_000);
  if (!limit.allowed) {
    return errorResponse(
      "RATE_LIMITED",
      "অনেকবার চেষ্টা করা হয়েছে — কিছুক্ষণ পর আবার চেষ্টা করুন।",
      429,
    );
  }

  const parsed = ticketReplySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", "বার্তা লিখুন।", 400, parsed.error.issues);
  }

  const ticket = await replyToTicketAsCustomer(customer.id, params.id, parsed.data.body);
  if (!ticket) return errorResponse("NOT_FOUND", "টিকিটটি পাওয়া যায়নি।", 404);

  return NextResponse.json({
    data: { ticket },
    meta: { persistence: "database" },
  });
}
