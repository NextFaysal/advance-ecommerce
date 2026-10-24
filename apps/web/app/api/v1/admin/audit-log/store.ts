/**
 * Audit-log data access — DB-backed (Prisma AuditLog table).
 *
 * This module used to be an in-memory demo store seeded with fictional
 * rows. It now reads/writes the real AuditLog table, delegating writes to
 * writeAudit() in src/lib/audit.ts so sanitization (secret-like keys become
 * "[REDACTED]") and the sensitive-action reason rule live in exactly one
 * place. The exported names/shapes are kept so the staff, audit-log and
 * feature-flags route contracts did not change — only the functions became
 * async, because they hit the database.
 *
 * There is NO seed/fictional data anymore: an empty AuditLog table yields
 * an empty list.
 */
import { prisma } from "@advance-ecommerce/db";
import { SENSITIVE_ACTIONS, sanitizeAuditJson, writeAudit } from "@/lib/audit";

export interface DemoAuditEntry {
  id: string;
  actorId: string | null;
  /** Display-only label for the actor (the actor User's name, when known). */
  actorLabel: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string; // ISO 8601
}

/** Sensitive actions (mirror of SENSITIVE_ACTIONS in src/lib/audit.ts) — these require a reason. */
export const DEMO_SENSITIVE_ACTIONS: ReadonlySet<string> = new Set(SENSITIVE_ACTIONS);

/** Delegates to sanitizeAuditJson() in src/lib/audit.ts (single source of truth). */
export function sanitizeDemoAuditJson(
  value: Record<string, unknown> | null,
): Record<string, unknown> | null {
  return sanitizeAuditJson(value);
}

interface AuditRow {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  beforeJson: unknown;
  afterJson: unknown;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  actor: { name: string | null; email: string | null } | null;
}

function toDemoAuditEntry(row: AuditRow): DemoAuditEntry {
  return {
    id: row.id,
    actorId: row.actorId,
    actorLabel: row.actor?.name ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    beforeJson: (row.beforeJson as Record<string, unknown> | null) ?? null,
    afterJson: (row.afterJson as Record<string, unknown> | null) ?? null,
    reason: row.reason,
    ip: row.ip,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface RecordDemoAuditInput {
  actorId?: string | null;
  actorLabel?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeJson?: Record<string, unknown> | null;
  afterJson?: Record<string, unknown> | null;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Append an entry to the AuditLog table via writeAudit() in src/lib/audit.ts.
 * Sensitive actions require a non-empty reason — writeAudit throws if it is
 * missing, so callers must validate first (routes do, via Zod). Snapshots
 * are sanitized by writeAudit. Throws if the write itself fails, so callers
 * that must not proceed unaudited (e.g. audit export) fail loudly instead
 * of silently skipping the record. `actorLabel` is accepted for call-site
 * compatibility and ignored — the label is derived from the actor User row.
 */
export async function recordDemoAudit(input: RecordDemoAuditInput): Promise<DemoAuditEntry> {
  const id = await writeAudit({
    actorId: input.actorId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    beforeJson: input.beforeJson ?? null,
    afterJson: input.afterJson ?? null,
    reason: input.reason ?? undefined,
    ip: input.ip ?? undefined,
    userAgent: input.userAgent ?? undefined,
  });
  if (id === null) {
    throw new Error(`Audit log write failed: ${input.action} on ${input.entityType}`);
  }
  const row = await prisma.auditLog.findUnique({
    where: { id },
    include: { actor: { select: { name: true, email: true } } },
  });
  if (row === null) {
    throw new Error(`Audit log row missing after write: ${id}`);
  }
  return toDemoAuditEntry(row);
}

export interface AuditFilters {
  actor?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: string; // ISO date/datetime, inclusive
  to?: string; // ISO date/datetime, inclusive
}

/** Newest-first filtered view over the AuditLog table. */
export async function filterDemoAuditEntries(filters: AuditFilters): Promise<DemoAuditEntry[]> {
  const actor = filters.actor?.trim();
  const fromMs = filters.from ? Date.parse(filters.from) : Number.NaN;
  const toMs = filters.to ? Date.parse(filters.to) : Number.NaN;
  const rows = await prisma.auditLog.findMany({
    where: {
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.entityId ? { entityId: filters.entityId } : {}),
      ...(!Number.isNaN(fromMs) || !Number.isNaN(toMs)
        ? {
            createdAt: {
              ...(!Number.isNaN(fromMs) ? { gte: new Date(fromMs) } : {}),
              ...(!Number.isNaN(toMs) ? { lte: new Date(toMs) } : {}),
            },
          }
        : {}),
      ...(actor
        ? {
            OR: [
              { actorId: { contains: actor, mode: "insensitive" as const } },
              { actor: { name: { contains: actor, mode: "insensitive" as const } } },
              { actor: { email: { contains: actor, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { actor: { select: { name: true, email: true } } },
  });
  return rows.map(toDemoAuditEntry);
}
