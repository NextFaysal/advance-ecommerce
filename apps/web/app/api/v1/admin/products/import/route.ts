import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireAdminSession } from "@/catalog/api";
import { hasPermission } from "@/lib/rbac";
import { previewImport } from "@/catalog/import";
import { previewXlsxImport } from "@/catalog/import-xlsx";

// POST /api/v1/admin/products/import — preview only (Step 10; P4;
// XLSX added in wave 16).
// Body: { csv: string, existingSkus?: string[] }             — CSV file
//    or { xlsxBase64: string, existingSkus?: string[] }      — .xlsx file
// Exactly one of csv / xlsxBase64. An .xlsx workbook is parsed
// server-side (first sheet only) into the same row table as CSV and
// runs through the identical validation pipeline.
// Returns a preview: valid rows, invalid rows (never silently
// dropped), an error-report CSV the admin can download and fix, the
// detected money unit per money column (poisha / taka / mixed), and
// the detected format ("csv" | "xlsx").
// Nothing is persisted here — persistence happens only when the
// admin confirms via POST ./import/confirm, which re-parses the file
// server-side and creates the valid rows as DRAFT products.
const bodySchema = z
  .object({
    csv: z.string().min(1).optional(),
    // ~15 MB of workbook as base64 — far above any real catalog file;
    // the cap keeps a hostile payload out of the parser.
    xlsxBase64: z.string().min(1).max(20_000_000).optional(),
    existingSkus: z.array(z.string()).optional(),
  })
  .refine((d) => (d.csv !== undefined) !== (d.xlsxBase64 !== undefined), {
    message: "Send exactly one of { csv } or { xlsxBase64 }.",
  });

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  if (!hasPermission(session.permissions, "products.import")) {
    return apiError("FORBIDDEN", "Missing permission: products.import", 403);
  }
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Send { csv: string } or { xlsxBase64: string }." } },
      { status: 400 },
    );
  }
  const existingSkus = new Set(parsed.data.existingSkus ?? []);

  if (parsed.data.xlsxBase64 !== undefined) {
    const result = previewXlsxImport(
      new Uint8Array(Buffer.from(parsed.data.xlsxBase64, "base64")),
      existingSkus,
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: { code: "INVALID_SPREADSHEET", message: result.message } },
        { status: 400 },
      );
    }
    const preview = result.preview;
    return NextResponse.json({
      data: {
        format: "xlsx" as const,
        totalRows: preview.totalRows,
        validCount: preview.validRows.length,
        invalidCount: preview.invalidRows.length,
        validRows: preview.validRows,
        invalidRows: preview.invalidRows,
        errorReportCsv: preview.errorReportCsv,
        moneyUnits: preview.moneyUnits,
      },
    });
  }

  const preview = previewImport(parsed.data.csv as string, existingSkus);
  return NextResponse.json({
    data: {
      format: "csv" as const,
      totalRows: preview.totalRows,
      validCount: preview.validRows.length,
      invalidCount: preview.invalidRows.length,
      validRows: preview.validRows,
      invalidRows: preview.invalidRows,
      errorReportCsv: preview.errorReportCsv,
      moneyUnits: preview.moneyUnits,
    },
  });
}
