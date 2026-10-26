import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { TICKET_STATUSES, type TicketStatus } from "@/support/schema";
import { loadSlaConfig } from "@/support/sla";
import { countTicketsByStatus, listTicketsForAdmin } from "@/support/store";

// GET /api/v1/admin/tickets — support ticket queue.
// RBAC: customers.view. There is no dedicated support.* permission in
// PERMISSIONS; tickets are customer-care work, so reads ride the
// customers permission family and writes (reply / status) require
// customers.edit — the same split customers themselves use.
// ?status=OPEN|PENDING|CLOSED filters; customer phone is MASKED.
// ?sla=breached keeps only tickets whose read-time SLA state is
// BREACHED (src/support/sla.ts); each ticket carries its `sla` block
// and meta echoes the configured targets.
export async function GET(req: Request) {
  const guard = await requireAdmin("customers.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const params = new URL(req.url).searchParams;
  const rawStatus = params.get("status");
  const status =
    rawStatus && (TICKET_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as TicketStatus)
      : undefined;
  const breachedOnly = params.get("sla") === "breached";

  const [tickets, counts, slaConfig] = await Promise.all([
    listTicketsForAdmin(status, { breachedOnly }),
    countTicketsByStatus(),
    loadSlaConfig(),
  ]);
  return NextResponse.json({
    data: { tickets, counts },
    meta: {
      persistence: "database",
      slaFirstResponseHours: slaConfig.firstResponseHours,
      slaResolutionHours: slaConfig.resolutionHours,
    },
  });
}
