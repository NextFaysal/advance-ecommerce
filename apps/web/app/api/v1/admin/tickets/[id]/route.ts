import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { setTicketStatusSchema } from "@/support/schema";
import { getTicketForAdmin, setTicketStatus } from "@/support/store";

// GET /api/v1/admin/tickets/[id] — full thread for staff.
// RBAC: customers.view (see the queue route for the permission
// rationale). Customer phone is MASKED in the payload.
// PATCH — set status (close / reopen). RBAC: customers.edit.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("customers.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const ticket = await getTicketForAdmin(params.id);
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

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("customers.edit");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const parsed = setTicketStatusSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid ticket status.", details: parsed.error.issues } },
      { status: 400 },
    );
  }

  const ticket = await setTicketStatus(params.id, parsed.data.status);
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
