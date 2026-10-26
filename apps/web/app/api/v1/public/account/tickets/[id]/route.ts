/**
 * GET /api/v1/public/account/tickets/[id] — one of the caller's own
 * tickets with its full thread. Ownership is enforced inside the
 * store query (id + customerId together), so another customer's
 * ticket answers 404 exactly like a missing one — existence and
 * content never leak across accounts.
 */
import { NextResponse } from "next/server";
import { errorResponse, methodNotAllowed, requireCustomer, unauthorized } from "@/customer-auth/http";
import { getTicketForCustomer } from "@/support/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();

  const ticket = await getTicketForCustomer(customer.id, params.id);
  if (!ticket) return errorResponse("NOT_FOUND", "টিকিটটি পাওয়া যায়নি।", 404);

  return NextResponse.json({
    data: { ticket },
    meta: { persistence: "database" },
  });
}

export function POST() {
  return methodNotAllowed();
}
