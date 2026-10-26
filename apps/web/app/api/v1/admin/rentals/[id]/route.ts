/**
 * Rental advance — PATCH /api/v1/admin/rentals/[id]
 * (ADV-23 vertical 3, wave 56).
 *
 * Guard: admin session + orders.edit, then the module.rental flag.
 * Body: { status } naming the TARGET status. Only ACTIVE ->
 * RETURNED, ACTIVE -> OVERDUE and OVERDUE -> RETURNED are
 * reachable from the board; anything else (re-advancing a final
 * rental, a board-side CANCELLED) is a 409 INVALID_TRANSITION that
 * names the allowed steps. CANCELLED is set only by the order
 * itself (the applyOrderTransition seam in src/rental/bookings.ts).
 * Marking RETURNED stamps returnedAt and moves NO money — the
 * frozen deposit is refunded manually in v1.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRentalAccess } from "@/rental/guard";
import { advanceRentalBooking } from "@/rental/bookings";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  status: z.enum(["ACTIVE", "RETURNED", "OVERDUE", "CANCELLED"]),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const outcome = await requireRentalAccess("orders.edit");
  if (!outcome.ok) return outcome.response;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Rental status input invalid.",
          details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
      },
      { status: 400 },
    );
  }

  const result = await advanceRentalBooking(params.id, parsed.data.status);
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.code, message: result.message } },
      { status: result.httpStatus },
    );
  }
  return NextResponse.json({ data: { rental: result.rental }, meta: { persistence: "database" } });
}
