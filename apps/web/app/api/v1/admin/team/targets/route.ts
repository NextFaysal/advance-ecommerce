/**
 * /api/v1/admin/team/targets?month=yyyy-mm
 *   GET (staff.view)   — targets for the month + REAL progress per
 *                        staff member (see the attribution rule in
 *                        src/team/targets.ts — printed in meta and
 *                        on /admin/team).
 *   PUT (staff.manage) — replace the month's target list (the form
 *                        sends the full list).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { listTeamStaff, monthSchema } from "@/team/docs";
import { requireTeamPermission, teamErrorResponse } from "@/team/guard";
import { computeProgress, getTargets, setTargets, targetEntrySchema } from "@/team/targets";
import { todayDhakaYmd } from "@/lib/dhaka-date";

export const dynamic = "force-dynamic";

const ATTRIBUTION_NOTE =
  "Progress attribution: handled = distinct orders the staff member transitioned INTO CONFIRMED in the month (OrderStatusHistory.changedById); revenue = Σ totals of orders they transitioned INTO DELIVERED. Transitions with no recorded actor count for nobody.";

async function monthFrom(req: Request): Promise<string | null> {
  const url = new URL(req.url);
  const parsed = monthSchema.safeParse(url.searchParams.get("month") ?? todayDhakaYmd().slice(0, 7));
  return parsed.success ? parsed.data : null;
}

export async function GET(req: Request) {
  const guard = await requireTeamPermission("staff.view");
  if (!guard.ok) return guard.response;
  try {
    const month = await monthFrom(req);
    if (month === null) {
      return NextResponse.json(
        { error: { code: "INVALID_INPUT", message: "month must be yyyy-mm." } },
        { status: 400 },
      );
    }
    const [staff, targets] = await Promise.all([listTeamStaff(), getTargets(month)]);
    const progress = await computeProgress(month, targets.map((t) => t.userId));
    const progressByUser = new Map(progress.map((p) => [p.userId, p]));
    return NextResponse.json({
      data: {
        month,
        staff,
        targets: targets.map((t) => ({
          ...t,
          progress: progressByUser.get(t.userId) ?? {
            userId: t.userId,
            handledOrders: 0,
            deliveredOrders: 0,
            deliveredRevenuePoisha: 0,
          },
        })),
      },
      meta: { persistence: "database", attribution: ATTRIBUTION_NOTE },
    });
  } catch (error) {
    return teamErrorResponse(error);
  }
}

const putSchema = z.object({
  month: monthSchema,
  targets: z.array(targetEntrySchema).max(500),
});

export async function PUT(req: Request) {
  const guard = await requireTeamPermission("staff.manage");
  if (!guard.ok) return guard.response;
  try {
    const parsed = putSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Targets input invalid.",
            details: parsed.error.issues,
          },
        },
        { status: 400 },
      );
    }
    const targets = await setTargets(parsed.data.month, parsed.data.targets, guard.user.id);
    return NextResponse.json({
      data: { month: parsed.data.month, targets },
      meta: { persistence: "database", attribution: ATTRIBUTION_NOTE },
    });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
