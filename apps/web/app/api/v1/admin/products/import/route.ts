import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireAdminSession } from "@/catalog/api";
import { hasPermission } from "@/lib/rbac";
import { previewImport } from "@/catalog/import";

// POST /api/v1/admin/products/import — preview only (Step 10; P4).
// Body: { csv: string, existingSkus?: string[] }
// Returns a preview: valid rows, invalid rows (never silently
// dropped), an error-report CSV the admin can download and fix, and
// the detected money unit per money column (poisha / taka / mixed).
// Nothing is persisted here — persistence happens only when the
// admin confirms via POST ./import/confirm, which re-parses the CSV
// server-side and creates the valid rows as DRAFT products.
const bodySchema = z.object({
  csv: z.string().min(1),
  existingSkus: z.array(z.string()).optional(),
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
      { error: { code: "VALIDATION_ERROR", message: "Send { csv: string }." } },
      { status: 400 },
    );
  }
  const preview = previewImport(parsed.data.csv, new Set(parsed.data.existingSkus ?? []));
  return NextResponse.json({
    data: {
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
