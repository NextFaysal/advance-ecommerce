import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { TICKET_STATUSES, type TicketStatus } from "@/support/schema";
import { countTicketsByStatus, listTicketsForAdmin } from "@/support/store";

// GET /api/v1/admin/tickets — support ticket queue.
// RBAC: customers.view. There is no dedicated support.* permission in
// PERMISSIONS; tickets are customer-care work, so reads ride the
// customers permission family and writes (reply / status) require
// customers.edit — the same split customers themselves use.
// ?status=OPEN|PENDING|CLOSED filters; customer phone is MASKED.
export async function GET(req: Request) {
  const guard = await requireAdmin("customers.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const rawStatus = new URL(req.url).searchParams.get("status");
  const status =
    rawStatus && (TICKET_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as TicketStatus)
      : undefined;

  const [tickets, counts] = await Promise.all([
    listTicketsForAdmin(status),
    countTicketsByStatus(),
  ]);
  return NextResponse.json({
    data: { tickets, counts },
    meta: { persistence: "database" },
  });
}
