import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { DEMO_SENSITIVE_ACTIONS, filterDemoAuditEntries, type AuditFilters } from "./store";

// Audit log list — Agent 39, DB-backed since the Prisma persistence swap.
// RBAC: audit.view. Persistence: the AuditLog table via Prisma (see
// ./store.ts). Sensitive actions are flagged `sensitive: true` (they
// required a reason when written). before/after snapshots were sanitized
// on write by src/lib/audit.ts — secret-like values only ever appear as
// "[REDACTED]".

const querySchema = z.object({
  actor: z.string().trim().min(1).optional(),
  action: z.string().trim().min(1).optional(),
  entity: z.string().trim().min(1).optional(),
  entityId: z.string().trim().min(1).optional(),
  from: z.string().trim().min(1).optional(),
  to: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(req: Request) {
  const guard = await requireAdmin("audit.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid audit-log query.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const { page, pageSize, entity, ...rest } = parsed.data;
  const filters: AuditFilters = { ...rest, entityType: entity };

  // Date filters must parse — a silently ignored bad date would mislead.
  for (const key of ["from", "to"] as const) {
    if (filters[key] !== undefined && Number.isNaN(Date.parse(filters[key]))) {
      return NextResponse.json(
        { error: { code: "INVALID_INPUT", message: `Filter "${key}" is not a valid date.` } },
        { status: 400 },
      );
    }
  }

  const all = await filterDemoAuditEntries(filters);
  const rows = all.slice((page - 1) * pageSize, page * pageSize);

  return NextResponse.json({
    data: {
      entries: rows.map((e) => ({ ...e, sensitive: DEMO_SENSITIVE_ACTIONS.has(e.action) })),
      total: all.length,
    },
    meta: {
      page,
      pageSize,
      persistence: "database",
      source: "AuditLog table via Prisma",
      note: "Real audit records from the AuditLog table. Snapshots were sanitized on write by src/lib/audit.ts (secret-like values appear only as [REDACTED]).",
    },
  });
}
