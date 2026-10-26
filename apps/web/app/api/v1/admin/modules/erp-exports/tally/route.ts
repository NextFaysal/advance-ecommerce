import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { writeAudit } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { erpStore } from "@/erp/db-store";
import { buildTallyXml, filterPostedInRange } from "@/erp/exports";

// Tally import XML export (ADV-11 remainder): POSTED journal entries
// in a business-date range, as Tally "Journal" vouchers. SAME export
// contract as the report exports: reason MANDATORY (blank -> 400),
// the export is audited, and attribution rides INSIDE the file as an
// XML comment in the prolog (a report-style `#` watermark block would
// corrupt the XML). Amounts convert poisha -> BDT decimal exactly at
// this boundary (src/erp/exports.ts). RBAC: reports.accounting;
// flag: module.erp_lite.
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
    action: "erp.export.tally",
    entityType: "ErpJournalExport",
    afterJson: { format: "tally-xml", from, to, entries: entries.length },
    reason,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  const xml = buildTallyXml({
    entries,
    accounts,
    from,
    to,
    exportedBy: guard.userId,
    exportedAt: new Date(),
    reason,
  });
  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="tally-journal-${from}-to-${to}.xml"`,
    },
  });
}
