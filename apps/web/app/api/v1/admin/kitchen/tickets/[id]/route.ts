/**
 * KDS ticket advance — PATCH /api/v1/admin/kitchen/tickets/[id]
 * (ADV-23, wave 56).
 *
 * Guard: admin session + orders.edit, then the module.restaurant
 * flag. Body: { status } naming the TARGET status. Transitions are
 * forward-only, one step at a time (QUEUED -> PREPARING -> READY ->
 * SERVED; readyAt is stamped on the move into READY). Any other
 * jump — skip, backwards, re-advance of a final ticket, or a
 * board-side CANCELLED — is a 409 INVALID_TRANSITION that names the
 * expected next step. CANCELLED is set only by the order itself
 * (the applyOrderTransition seam in src/restaurant/tickets.ts).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRestaurantAccess } from "@/restaurant/guard";
import { advanceKitchenTicket } from "@/restaurant/tickets";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  status: z.enum(["QUEUED", "PREPARING", "READY", "SERVED", "CANCELLED"]),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const outcome = await requireRestaurantAccess("orders.edit");
  if (!outcome.ok) return outcome.response;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Ticket status input invalid.",
          details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
      },
      { status: 400 },
    );
  }

  const result = await advanceKitchenTicket(params.id, parsed.data.status);
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.code, message: result.message } },
      { status: result.httpStatus },
    );
  }
  return NextResponse.json({ data: { ticket: result.ticket }, meta: { persistence: "database" } });
}
