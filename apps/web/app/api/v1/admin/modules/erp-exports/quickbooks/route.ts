import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { writeAudit } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { erpStore } from "@/erp/db-store";
import { buildQuickBooksCsv, filterPostedInRange } from "@/erp/exports";

// QuickBooks journal CSV export (ADV-11 remainder): POSTED journal
// entries in a business-date range, one CSV row per journal line in
// the QuickBooks Online journal-import shape (Date MM/DD/YYYY,
// JournalNo, Account, Debit, Credit, Memo — unused side blank).
// SAME export contract as the report exports: reason MANDATORY
// (blank -> 400), audited; attribution rides as ONE leading `#`
// comment row (delete it before importing into QuickBooks — QBO
// reads row 1 as the header; the admin panel says so). Amounts
// convert poisha -> BDT decimal exactly at this boundary
// (src/erp/exports.ts). RBAC: reports.accounting; flag:
// module.erp_lite.
const bodySchema = z.object({
  from: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "from must be yyyy-mm-dd"),
  to: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "to must be yyyy-mm-dd"),
  reason: z.string().trim().min(1, "A non-empty export reason is required."),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("reports.accounting");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isFeatureEnabled("module.erp_lite")) {
    return NextResponse.json(
      { error: { code: "FEATURE_LOCKED", message: "ERP-lite module is locked for this install (module.erp_lite is OFF)." } },
      { status: 403 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid export range.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const { from, to, reason } = parsed.data;
  if (from > to) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "`from` must be on or before `to`." } },
      { status: 400 },
    );
  }
  const [allEntries, accounts] = await Promise.all([erpStore.listEntries(), erpStore.listAccounts()]);
  const entries = filterPostedInRange(allEntries, from, to);
  await writeAudit({
    actorId: guard.userId,
    action: "erp.export.quickbooks",
    entityType: "ErpJournalExport",
    afterJson: { format: "quickbooks-csv", from, to, entries: entries.length },
    reason,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  const csv = buildQuickBooksCsv({
    entries,
    accounts,
    from,
    to,
    exportedBy: guard.userId,
    exportedAt: new Date(),
    reason,
  });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="quickbooks-journal-${from}-to-${to}.csv"`,
    },
  });
}
