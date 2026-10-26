import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { writeAudit } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { PayrollError, finalizePayrollRun } from "@/erp/payroll";

// Finalize a payroll run (ADV-11 remainder): flips the run to
// FINALIZED and posts ONE journal entry through the ERP auto-posting
// machinery (Dr 5300 Salary gross / Cr 1010 Bank net / Cr 2000 AP
// deductions withheld — see src/erp/payroll.ts header for the account
// rationale). A locked accounting period refuses with 409 and the
// run stays DRAFT. Reason mandatory, audited. RBAC:
// reports.accounting; flag: module.erp_lite.
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

const finalizeSchema = z.object({
  runId: z.string().min(1),
  reason: z.string().trim().min(1, "A reason is required."),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("reports.accounting");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isFeatureEnabled("module.erp_lite")) return locked();
  const body = await req.json().catch(() => ({}));
  const parsed = finalizeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid finalize request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const { run, journal } = await finalizePayrollRun(parsed.data.runId, guard.userId);
    await writeAudit({
      actorId: guard.userId,
      action: "erp.payroll.run.finalize",
      entityType: "ErpPayrollRun",
      entityId: run.id,
      afterJson: {
        month: run.month,
        totalPoisha: run.totalPoisha,
        journalEntryId: run.journalEntryId,
        journalStatus: journal.status,
      },
      reason: parsed.data.reason,
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({
      data: { run, journal },
      meta: { persistence: "database" },
    });
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
