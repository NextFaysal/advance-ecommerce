import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { expectedShipmentSchema } from "@/bd/courier-reconciliation";
import {
  buildExpectedFromSandbox,
  importedTrackingIdsFor,
  recordRun,
  runCourierInvoiceImport,
} from "@/bd/courier-invoice";

// POST /api/v1/admin/bd/courier-invoice/import — Agent 50.
// RBAC: reports.accounting.
// Body: { courierKey, csvText, expected? } — the courier invoice CSV
// (taka decimal strings, see src/bd/courier-invoice.ts for the format).
// Expected rows are built from the sandbox shipment/COD shapes unless
// the caller supplies explicit expected rows (validated by the existing
// reconciliation schema). Valid CSV rows are fed to the EXISTING
// reconciliation; invalid rows come back with row numbers — none are
// silently dropped. Persistence is the in-memory demo store.
const importRequestSchema = z.object({
  courierKey: z.string().min(1),
  csvText: z.string().min(1),
  expected: z.array(expectedShipmentSchema).min(1).optional(),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("reports.accounting");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const parsed = importRequestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid courier invoice import request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const { courierKey, csvText } = parsed.data;
  const fromSandbox = parsed.data.expected ? null : buildExpectedFromSandbox(courierKey);
  const run = runCourierInvoiceImport({
    courierKey,
    csvText,
    expected: parsed.data.expected ?? fromSandbox?.expected ?? [],
    skippedShipments: fromSandbox?.skippedCount ?? 0,
    alreadyImported: importedTrackingIdsFor(courierKey),
  });
  recordRun(run);
  return NextResponse.json({
    data: {
      runId: run.runId,
      courierKey: run.courierKey,
      importedAt: run.importedAt,
      totalRows: run.totalRows,
      validRowCount: run.validRowCount,
      invalidRows: run.invalidRows,
      errorReportCsv: run.errorReportCsv,
      orderIdMismatches: run.orderIdMismatches,
      skippedShipments: run.skippedShipments,
      summary: run.summary,
      rows: run.rows,
    },
    meta: { persistence: "in-memory-demo" },
  });
}
