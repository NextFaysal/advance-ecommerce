import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { listAdjustments, listDisputes, listInvoiceRuns } from "@/bd/courier-invoice";

// GET /api/v1/admin/bd/courier-invoice — Agent 50.
// RBAC: reports.accounting.
// Lists import runs (summary + rows), disputes, and dispute adjustments
// from the DB-backed store (courier_invoice_runs / courier_disputes /
// dispute_adjustments; run row detail is served from the process cache
// when available — see src/bd/courier-invoice.ts drift notes). Run rows
// keep their ORIGINAL expected and invoiced amounts — a dispute never
// rewrites them; an accepted dispute's agreed correction appears only
// as an adjustment record.
export async function GET() {
  const guard = await requireAdmin("reports.accounting");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const [allRuns, disputes, adjustments] = await Promise.all([
    listInvoiceRuns(),
    listDisputes(),
    listAdjustments(),
  ]);
  const runs = allRuns.map((run) => ({
    runId: run.runId,
    courierKey: run.courierKey,
    importedAt: run.importedAt,
    totalRows: run.totalRows,
    validRowCount: run.validRowCount,
    invalidRowCount: run.invalidRows.length,
    orderIdMismatches: run.orderIdMismatches,
    skippedShipments: run.skippedShipments,
    summary: run.summary,
    rows: run.rows,
  }));
  return NextResponse.json({
    data: { runs, disputes, adjustments },
    meta: { persistence: "database" },
  });
}
