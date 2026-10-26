import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { ticketReplySchema } from "@/support/schema";
import { replyToTicketAsStaff } from "@/support/store";

// POST /api/v1/admin/tickets/[id]/reply — staff reply.
// RBAC: customers.edit (writes ride the edit permission; see the
// queue route header). The reply is stored with authorId = the
// staff user's id and moves the ticket to PENDING.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("customers.edit");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const parsed = ticketReplySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Reply body is required.", details: parsed.error.issues } },
      { status: 400 },
    );
  }

  const ticket = await replyToTicketAsStaff(guard.userId, params.id, parsed.data.body);
  if (!ticket) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Ticket not found." } },
      { status: 404 },
    );
  }
  return NextResponse.json({
    data: { ticket },
    meta: { persistence: "database" },
  });
}
