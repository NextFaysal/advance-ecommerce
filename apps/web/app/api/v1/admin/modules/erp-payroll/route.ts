import { NextResponse } from "next/server";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { writeAudit } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import {
  PayrollError,
  getPayrollReadModel,
  salaryConfigSchema,
  updateSalaries,
} from "@/erp/payroll";

// ERP payroll-lite — ADV-11 remainder. RBAC: reports.accounting (the
// ERP sibling routes' permission). Everything sits behind the
// module.erp_lite flag: OFF -> 403 FEATURE_LOCKED (gift-cards
// pattern). GET returns the payroll doc (salary configs + runs) plus
// the staff directory so the admin panel can render the config table
// for every staff member. PUT replaces the WHOLE salary-config map
// (omitting a staff member removes their config); a reason is
// mandatory and the change is audited.
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

function payrollErrorResponse(err: unknown) {
  if (err instanceof PayrollError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      { status: err.httpStatus },
    );
  }
  throw err;
}

const putSchema = z.object({
  salaries: z.record(z.string().min(1), salaryConfigSchema),
  reason: z.string().trim().min(1, "A reason is required."),
});

export async function GET() {
  await ensureDbFeatureFlags().catch(() => {});
  const guard = await requireAdmin("reports.accounting");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isFeatureEnabled("module.erp_lite")) return locked();
  const { doc, staff } = await getPayrollReadModel();
  return NextResponse.json({
    data: {
      salaries: doc.salaries,
      runs: doc.runs,
      staff: staff.map((s) => ({ id: s.id, name: s.name, email: s.email, role: s.role, status: s.status })),
    },
    meta: { persistence: "database", source: "Setting doc erp.payroll" },
  });
}

export async function PUT(req: Request) {
  await ensureDbFeatureFlags().catch(() => {});
  const guard = await requireAdmin("reports.accounting");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isFeatureEnabled("module.erp_lite")) return locked();
  const body = await req.json().catch(() => ({}));
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid salary config.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const before = (await getPayrollReadModel()).doc.salaries;
    const doc = await updateSalaries(parsed.data.salaries, guard.userId);
    await writeAudit({
      actorId: guard.userId,
      action: "erp.payroll.salaries.update",
      entityType: "ErpPayroll",
      entityId: "erp.payroll",
      beforeJson: { salaries: before },
      afterJson: { salaries: doc.salaries },
      reason: parsed.data.reason,
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({
      data: { salaries: doc.salaries, runs: doc.runs },
      meta: { persistence: "database" },
    });
  } catch (err) {
    return payrollErrorResponse(err);
  }
}
