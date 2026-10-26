/**
 * /api/v1/admin/team/shifts/[id]
 *   PATCH  (staff.manage) — replace a shift's fields.
 *   DELETE (staff.manage) — remove a shift. Existing attendance
 *                           entries keep the shift NAME they recorded
 *                           at check-in (history is never rewritten).
 */
import { NextResponse } from "next/server";
import { requireTeamPermission, teamErrorResponse } from "@/team/guard";
import { deleteShift, shiftInputSchema, updateShift } from "@/team/shifts";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireTeamPermission("staff.manage");
  if (!guard.ok) return guard.response;
  try {
    const parsed = shiftInputSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Shift input invalid.",
            details: parsed.error.issues,
          },
        },
        { status: 400 },
      );
    }
    const shift = await updateShift(params.id, parsed.data, guard.user.id);
    return NextResponse.json({ data: { shift }, meta: { persistence: "database" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireTeamPermission("staff.manage");
  if (!guard.ok) return guard.response;
  try {
    await deleteShift(params.id, guard.user.id);
    return NextResponse.json({ data: { deleted: true }, meta: { persistence: "database" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
