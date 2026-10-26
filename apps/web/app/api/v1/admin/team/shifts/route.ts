/**
 * /api/v1/admin/team/shifts
 *   GET  (staff.view)   — all shifts + the staff directory (for the
 *                         roster picker's names).
 *   POST (staff.manage) — create a shift {name, startHHMM, endHHMM,
 *                         userIds}. Unknown staff ids are rejected.
 *
 * Shifts are informational (see src/team/shifts.ts): no payroll math.
 */
import { NextResponse } from "next/server";
import { listTeamStaff } from "@/team/docs";
import { requireTeamPermission, teamErrorResponse } from "@/team/guard";
import { createShift, listShifts, shiftInputSchema } from "@/team/shifts";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireTeamPermission("staff.view");
  if (!guard.ok) return guard.response;
  try {
    const [shifts, staff] = await Promise.all([listShifts(), listTeamStaff()]);
    return NextResponse.json({ data: { shifts, staff }, meta: { persistence: "database" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}

export async function POST(req: Request) {
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
    const shift = await createShift(parsed.data, guard.user.id);
    return NextResponse.json({ data: { shift }, meta: { persistence: "database" } }, { status: 201 });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
