/**
 * Booking advance — PATCH /api/v1/admin/bookings/[id]
 * (ADV-23, wave 56).
 *
 * Guard: admin session + orders.edit, then the module.services
 * flag. Body: { status } naming the TARGET status. Only
 * BOOKED -> COMPLETED and BOOKED -> NO_SHOW are reachable from the
 * board; anything else (re-advancing a final booking, a board-side
 * CANCELLED) is a 409 INVALID_TRANSITION that names the allowed
 * steps. CANCELLED is set only by the order itself (the
 * applyOrderTransition seam in src/services/bookings.ts).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireServicesAccess } from "@/services/guard";
import { advanceServiceBooking } from "@/services/bookings";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  status: z.enum(["BOOKED", "COMPLETED", "CANCELLED", "NO_SHOW"]),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const outcome = await requireServicesAccess("orders.edit");
  if (!outcome.ok) return outcome.response;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Booking status input invalid.",
          details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
      },
      { status: 400 },
    );
  }

  const result = await advanceServiceBooking(params.id, parsed.data.status);
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.code, message: result.message } },
      { status: result.httpStatus },
    );
  }
  return NextResponse.json({ data: { booking: result.booking }, meta: { persistence: "database" } });
}
