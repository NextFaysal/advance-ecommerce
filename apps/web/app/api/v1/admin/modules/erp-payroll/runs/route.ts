import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { writeAudit } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { PayrollError, createPayrollRun } from "@/erp/payroll";

// Create a payroll run for one month (ADV-11 remainder). The run
// snapshots the CURRENT salary config for ACTIVE staff whose config
// is effective on or before the month. One run per month — a second
// create for the same month is a 409 DUPLICATE_RUN. Reason mandatory,
// audited. RBAC: reports.accounting; flag: module.erp_lite.
function locked() {
  return NextResponse.json(
    {
      error: {
        code: "FEATURE_LOCKED",
        message: "ERP-lite module is locked for this install (module.erp_lite is OFF).",
      },
    },
    { status: 403 },
  );
}

const createSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be yyyy-mm"),
  reason: z.string().trim().min(1, "A reason is required."),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("reports.accounting");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isFeatureEnabled("module.erp_lite")) return locked();
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid run request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const run = await createPayrollRun(parsed.data.month, guard.userId);
    await writeAudit({
      actorId: guard.userId,
      action: "erp.payroll.run.create",
      entityType: "ErpPayrollRun",
      entityId: run.id,
      afterJson: { month: run.month, lines: run.lines.length, totalPoisha: run.totalPoisha },
      reason: parsed.data.reason,
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ data: { run }, meta: { persistence: "database" } }, { status: 201 });
  } catch (err) {
    if (err instanceof PayrollError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message, details: err.details } },
        { status: err.httpStatus },
      );
    }
    throw err;
  }
}
