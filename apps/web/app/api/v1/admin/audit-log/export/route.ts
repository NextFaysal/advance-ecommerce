import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import {
  filterDemoAuditEntries,
  recordDemoAudit,
  type AuditFilters,
  type DemoAuditEntry,
} from "../store";

// Audit log export — Agent 39, DB-backed since the Prisma persistence swap.
// RBAC: audit.view. A reason is MANDATORY (Zod): audit exports are
// sensitive actions per src/lib/audit.ts rules, and the export itself is
// recorded as an audit entry in the AuditLog table (action "audit.export").
// The CSV carries a watermark header: exported-by, exported-at
// (Asia/Dhaka) and the reason. Snapshots were sanitized on write by
// src/lib/audit.ts — no secret value can appear in the output.

const exportSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required to export the audit log."),
  actor: z.string().trim().min(1).optional(),
  action: z.string().trim().min(1).optional(),
  entity: z.string().trim().min(1).optional(),
  entityId: z.string().trim().min(1).optional(),
  from: z.string().trim().min(1).optional(),
  to: z.string().trim().min(1).optional(),
});

function csvCell(value: string | null): string {
  if (value === null) return "";
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function dhakaTimestamp(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function rowToCsv(e: DemoAuditEntry): string {
  return [
    e.id,
    e.createdAt,
    e.actorId,
    e.action,
    e.entityType,
    e.entityId,
    e.reason,
    e.ip,
    e.beforeJson ? JSON.stringify(e.beforeJson) : null,
    e.afterJson ? JSON.stringify(e.afterJson) : null,
  ]
    .map((v) => csvCell(v === null ? null : String(v)))
    .join(",");
}

export async function POST(req: Request) {
  const guard = await requireAdmin("audit.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const body = await req.json().catch(() => null);
  const parsed = exportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "A non-empty export reason is required.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const { reason, entity, ...rest } = parsed.data;
  const filters: AuditFilters = { ...rest, entityType: entity };
  for (const key of ["from", "to"] as const) {
    if (filters[key] !== undefined && Number.isNaN(Date.parse(filters[key]))) {
      return NextResponse.json(
        { error: { code: "INVALID_INPUT", message: `Filter "${key}" is not a valid date.` } },
        { status: 400 },
      );
    }
  }

  const rows = await filterDemoAuditEntries(filters);
  const now = new Date();
  const filterSummary =
    Object.entries({ ...rest, entity })
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ") || "none";

  const lines = [
    "# AUDIT LOG EXPORT — Advance Ecommerce (AuditLog table records)",
    `# exported-by: ${guard.userId}`,
    `# exported-at: ${dhakaTimestamp(now)} (Asia/Dhaka)`,
    `# reason: ${reason.replace(/\n/g, " ")}`,
    `# filters: ${filterSummary}`,
    `# rows: ${rows.length}`,
    "id,createdAt,actorId,action,entityType,entityId,reason,ip,beforeJson,afterJson",
    ...rows.map(rowToCsv),
  ];
  const csv = lines.join("\n");

  // The export itself is audited (in the AuditLog table, like everything here).
  const auditEntry = await recordDemoAudit({
    actorId: guard.userId,
    action: "audit.export",
    entityType: "AuditLog",
    entityId: null,
    afterJson: { rows: rows.length, filters: filterSummary },
    reason,
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({
    data: {
      filename: `audit-log-export-${now.toISOString().slice(0, 10)}.csv`,
      contentType: "text/csv",
      csv,
      rowCount: rows.length,
      auditEntryId: auditEntry.id,
    },
    meta: {
      persistence: "database",
      source: "AuditLog table via Prisma",
      note: "Export generated from the AuditLog table and recorded there as an audit entry via writeAudit().",
    },
  });
}
